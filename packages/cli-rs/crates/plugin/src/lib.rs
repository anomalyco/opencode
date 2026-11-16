//! The plugin host (P.1, P.4, O-67): the TUI's side of the one plugin API, `opencode-plugin-abi`. Built-ins and
//! external plugins reach the TUI only through that API, in process or over the C ABI. [`Registry`] starts them,
//! resolves their slot claims and mounts them; [`loader`] finds and loads external plugins; [`node`] turns what a
//! plugin draws into widgets. The TUI implements [`Host`] once, and that is the only code here that sees it.

mod activation;
pub mod behave;
pub mod canvas;
pub mod claim;
pub mod conformance;
pub mod contain;
pub mod image;
pub mod interact;
pub mod limits;
mod list;
pub mod loader;
#[cfg(feature = "luau")]
pub mod luau;
pub mod mailbox;
pub mod node;
pub mod pipe;
pub mod reconcile;
mod route;
pub mod schedule;
pub mod slot;
pub mod storage;
pub mod surface;

use std::any::Any;
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::{Rc, Weak};
use std::sync::Arc;

use activation::{Activation, Drawn};
pub use opencode_plugin_abi as abi;
use opencode_ui::dialog::DialogKeymap;
use opencode_ui::keymap::{Bind, Slash, TuiCommand};
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
    /// Says that plugin `id` became slow (synthesis 4.4), once a session: `cost` is what a slow frame of it costs.
    /// Called outside every plugin callback.
    fn slow(&self, id: &str, cost: &str) {
        self.toast(
            &abi::Toast::new(abi::Variant::Warning, format!("{cost}. Run /plugins to disable it."))
                .title(format!("Plugin is slow: {id}")),
        );
    }
    /// A plugin became slow or stopped being slow, which the plugin list shows: told on every change, where
    /// [`Host::slow`] is told once a session. Called outside every plugin callback.
    fn slow_changed(&self) {}
    /// Ends what the host shows for an activation of plugin `id` that ended (it was disabled, replaced, unloaded, or
    /// failed): the dialog it opened, if that activation is no longer [`Registry::live`], so nothing of an old build can
    /// run (4.14). Called outside every plugin callback.
    fn revoked(&self, _id: &str) {}
    /// Says that the project plugin of `target` waits for the user's approval (rich-plugins 3.9): once a build, as the
    /// loader finds it. Called outside every plugin callback.
    fn pending(&self, target: &str) {
        self.toast(
            &abi::Toast::new(
                abi::Variant::Warning,
                "This project wants to run native code inside opencode. Run /plugins to approve or decline it.",
            )
            .title(format!("Plugin needs approval: {target}")),
        );
    }
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
    /// The plugins on disk may load differently now (a held target was released): the host has the loader look again.
    fn plugins_changed(&self) {}
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
    /// Edits the composer on screen ([`abi::Host::edit_composer`]). Called outside every plugin callback.
    fn edit_composer(&self, _edit: abi::ComposerEdit) {}
    /// Selects `variant` of the model the next prompt uses ([`abi::Host::set_variant`]), once [`Staged::variant_known`] allowed
    /// it. Called outside every plugin callback.
    fn set_variant(&self, _variant: Option<&str>) {}
    /// Selects a model for the next prompt ([`abi::Host::set_model`]). Called outside every plugin callback.
    fn set_model(&self, _provider: &str, _model: &str) {}
    /// Whether `edit` would change the session tabs ([`abi::Host::edit_tab`]) once `staged`, the edits the same call
    /// made before it, which the host allowed, changed them.
    fn tab_allowed(&self, _edit: &abi::TabEdit, _staged: &[abi::TabEdit]) -> bool {
        false
    }
    /// Changes the session tabs, once [`Host::tab_allowed`] allowed it. Called outside every plugin callback.
    fn edit_tab(&self, _edit: abi::TabEdit) {}
    /// Clears the mouse selection ([`abi::Host::clear_selection`]). Called outside every plugin callback.
    fn clear_selection(&self) {
        self.app().clear_selection();
    }
    /// Runs `program` in the foreground ([`abi::Host::foreground`]) while `alive` holds for the plugin that asked, which
    /// the host checks as the program starts, and calls `reply` on the UI thread once with its exit code or the error.
    /// Called outside every plugin callback.
    fn foreground(&self, _program: abi::Foreground, _alive: Box<dyn Fn() -> bool>, reply: Reply) {
        reply(Err("this host has no terminal".to_owned()));
    }
    /// Sets the terminal title ([`abi::Host::set_title`]). Called outside every plugin callback.
    fn set_title(&self, title: &str) {
        // A title OpenTUI refuses would end the app.
        self.app().set_title(&opencode_ui::terminal_title(title));
    }
    /// Selects theme `name`, once [`Staged::theme_known`] allowed it ([`abi::Host::set_theme`]). Called outside every plugin
    /// callback.
    fn set_theme(&self, _name: &str) {}
    /// Installs theme `name` ([`abi::Host::install_theme`]). Called outside every plugin callback.
    fn install_theme(&self, _name: &str, _theme: serde_json::Value) {}
    /// Saves `value` as the user's setting `name` ([`abi::Host::set_setting`]). Called outside every plugin callback.
    fn set_setting(&self, _name: &str, _value: serde_json::Value) {}
    /// Calls `run` with the streaming deltas the host applied since the last call, or since this, at most once a frame,
    /// until the disposer is dropped ([`abi::Setup::on_deltas`]).
    fn on_deltas(&self, _run: Deltas) -> Option<Disposer> {
        None
    }
    /// The widget of an [`abi::Node::Markdown`]. By default, Markdown in the page theme without plugin fences.
    fn markdown(&self, text: &str) -> opentui::widget::Markdown {
        let theme = self.theme();
        let syntax = opencode_ui::code::syntax_theme(&theme);
        let renderers = CodeBlockRenderers::default();
        let markdown = opencode_ui::markdown::view(self.app(), &theme, &syntax, &renderers, true, false);
        markdown.set_markdown(text)
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
    /// How many changes of its own state the host has made that [`Host::watch`] tells of, when it counts them: a claim
    /// that drew at the count it has now has seen them all.
    fn local_revision(&self) -> Option<u64> {
        None
    }

    // Contract 2.0's input and surfaces (P2, [`interact`]).

    /// The input registrations of the plugins; without one, a host routes no plugin input.
    fn router(&self) -> Option<&interact::Router> {
        None
    }
    /// Whether the composer has the focus.
    fn composer_focused(&self) -> bool {
        false
    }
    /// Gives the composer the focus, as when a plugin's surface that had it goes.
    fn focus_composer(&self) {}
    /// The plugins moved the focus ([`interact::refocus`]): the host's own idea of which pane has the input follows it.
    fn focus_moved(&self) {}
    /// Whether a dialog of the host is on screen, which ends a plugin's pointer capture.
    fn modal_open(&self) -> bool {
        false
    }
    /// The layer the plugins' overlays show in: over the routes, under the host's dialogs.
    fn overlay_layer(&self) -> Option<View> {
        None
    }
    /// Opens plugin `id`'s panel surface. Called outside every plugin callback.
    fn open_panel(&self, _id: &str, _open: &abi::interact::OpenPanel) {}
    /// Closes plugin `id`'s panel `surface`, if it shows. Called outside every plugin callback.
    fn close_panel(&self, _id: &str, _surface: &str) {}
    /// How plugin `id`'s panel `surface` shows now, if it does.
    fn panel_input(&self, _id: &str, _surface: &str) -> Option<abi::interact::PanelInput> {
        None
    }
}

/// What a host request of a plugin calls with its result on the UI thread: a fetch's or a program's.
pub type Reply = Box<dyn FnOnce(Result<serde_json::Value, String>)>;
/// What [`Host::on_deltas`] calls with the deltas.
pub type Deltas = Rc<dyn Fn(&[abi::types::V2Event])>;

/// A mounted slot claim or plugin route: its root view, and a sync with each change batch. A plain [`View`] never
/// changes.
pub(crate) trait Claimed {
    fn root(&self) -> View;
    fn sync(&self, _host: &dyn Host, _changed: &abi::Changed) {}
    /// Takes the host's theme in place; false when the claim must mount again instead.
    fn restyle(&self, _host: &dyn Host) -> bool {
        false
    }
}

impl Claimed for View {
    fn root(&self) -> View {
        self.clone()
    }
}

type ClaimRender = Rc<dyn Fn(&dyn Host, &SlotInput) -> Box<dyn Claimed>>;
type Claim = Box<dyn Claimed>;
type RouteRender = Rc<dyn Fn(&dyn Host) -> Box<dyn Claimed>>;
type PanelRender = Rc<dyn Fn(&dyn Host, &View) -> Box<dyn Claimed>>;
pub(crate) type SearchCall = Rc<dyn Fn(&dyn Host, &str, &[abi::SelectOption]) -> Option<Vec<String>>>;
type SetupFn = Rc<dyn Fn(&mut Setup<'_>) -> Result<(), String>>;
/// The current failure of an external plugin, if any.
pub type ErrorFn = Rc<dyn Fn() -> Option<String>>;
/// Renders a fenced code block in the theme, or returns `None` to keep the default code view.
type CodeBlockRender = Rc<dyn Fn(&CodeBlock<'_>, &Theme) -> Option<AnyWidget>>;

/// A built-in, in the order the registry activates it.
pub enum Builtin {
    /// A plugin of the one API, run in process.
    Plugin(abi::Plugin),
    /// The same plugin through the byte shims of the C ABI, as a loaded library runs: its other carrier, for the tests
    /// that compare the two (`carrier-equal`).
    Abi(abi::Plugin),
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
    /// What tells an external plugin's build from another one: the loader's digest of its library and options.
    digest: Option<String>,
}

impl Definition {
    #[cfg(test)]
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
        Self { id: id.into(), setup: Rc::new(setup), target: None, error: None, digest: None }
    }

    /// Marks an external plugin loaded from `target`; `error` reports its failure while it is active.
    pub(crate) fn external(mut self, target: impl Into<String>, error: ErrorFn) -> Self {
        self.target = Some(target.into());
        self.error = Some(error);
        self
    }

    /// Names the build of an external plugin.
    pub(crate) fn digest(mut self, digest: u64) -> Self {
        self.digest = Some(format!("{digest:016x}"));
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
            Builtin::Abi(plugin) => loader::native::carried(plugin),
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
    linked(plugin.id, Rc::new(move |setup, _| (plugin.setup)(setup)), false)
}

/// What a linked plugin's setup is given beside the registration: the limits of the budget, for a carrier that
/// enforces them itself (Luau's interrupt).
pub(crate) type LinkedSetup = Rc<dyn Fn(&mut abi::Setup<'_>, contain::Limits) -> Result<(), String>>;

/// A plugin whose closures run in process on the built-ins' [`Scope`]: a built-in, or an `external` plugin whose
/// carrier is in process too (Luau), which an overrun fails as it fails a library.
pub(crate) fn linked(id: impl Into<String>, run: LinkedSetup, external: bool) -> Definition {
    // The failure of the running activation: a call that panicked.
    let failure: Rc<RefCell<Option<String>>> = Rc::default();
    let error: ErrorFn = {
        let failure = failure.clone();
        Rc::new(move || failure.borrow().clone())
    };
    let mut definition = Definition::fallible(id, move |setup: &mut Setup<'_>| {
        *failure.borrow_mut() = None;
        let failed = failure.clone();
        setup.failure(Rc::new(move || failed.borrow().clone()));
        let proxy = setup.host().app().proxy();
        let mailbox = mailbox::Mailbox::new(setup.id(), Arc::new(activation::Wake::new(Some(proxy))));
        let activation = Activation::new(setup.host(), mailbox.clone());
        activation.set_monitor(setup.monitor.clone(), setup.monitor.slot(&setup.artifact()));
        let scope = Rc::new(Scope {
            host: Rc::downgrade(setup.host()),
            id: setup.id().to_owned(),
            generation: setup.generation(),
            keys: RefCell::default(),
            activation: activation.clone(),
            replies: RefCell::default(),
            failure: failure.clone(),
            call: RefCell::default(),
            revoked: RefCell::default(),
            mount: RefCell::default(),
            monitor: setup.monitor.clone(),
            slot: setup.monitor.slot(&setup.artifact()),
            owners: Owners::new(setup.id(), Rc::downgrade(setup.host()), &activation),
            external,
        });
        let limits = setup.monitor.limits();
        let mut api = abi::Registered::new(setup.id(), None);
        api.set_waker(activation.waker());
        api.set_link(mailbox);
        // Setup reaches the host as a command does: its effects wait on the one queue. A setup that panics runs its
        // dispose callbacks within the same call, as the C ABI's `create` does, so nothing either asked for happens.
        let (set_up, _) = scope.monitor.call(scope.slot, "setup", || {
            scope.attempt(&**setup.host(), |host| match contain::catch(|| run(&mut api.setup_with(host), limits)) {
                Ok(set_up) => set_up,
                Err(panic) => {
                    api.dispose(Some(host));
                    std::panic::resume_unwind(panic)
                }
            })
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
        if !api.plugins().is_empty() {
            let (heard, scope) = (api.plugins().to_vec(), scope.clone());
            setup.on_plugins(Rc::new(move || scope.run("on-plugins", |host| heard.iter().for_each(|run| run(host)))));
        }
        // A thread's message runs the message handler as `update`; a thread's panic fails the plugin, once. A plugin
        // without a handler refuses messages, also those its setup sent.
        let (handler, delivered, failing) = (api.message().cloned(), Rc::downgrade(&scope), Rc::downgrade(&scope));
        if handler.is_none() {
            activation.mailbox.refuse_messages();
        }
        activation.on_mail(
            Rc::new(move |message| {
                if let (Some(scope), Some(run)) = (delivered.upgrade(), &handler) {
                    scope.run("update", |host| run(host, message));
                }
            }),
            Rc::new(move |error| {
                if let Some(scope) = failing.upgrade() {
                    let revoked = scope.revoked.take();
                    crate::fail(&scope.host, &scope.id, &scope.failure, revoked, &scope.activation, error);
                }
            }),
        );
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
            setup.claim(slot::placement(claim), render, mount, claim.size, &activation);
        }
        let revoked = &scope.revoked;
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
            revoked.borrow_mut().extend(subscription);
        }
        if !api.deltas().is_empty() {
            let (runs, scope) = (api.deltas().to_vec(), scope.clone());
            let subscription = setup.host().on_deltas(Rc::new(move |events| {
                scope.run("on-deltas", |host| runs.iter().for_each(|run| run(host, events)));
            }));
            revoked.borrow_mut().extend(subscription);
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
        let (layers, scoped) = route::split(commands);
        for layer in layers.into_iter().filter(|layer| !layer.commands.is_empty()) {
            // Kept apart from the registration, so a panic can remove it.
            match setup.host().keymap().layer(layer) {
                Ok(disposer) => scope.revoked.borrow_mut().push(disposer),
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
        for (name, search) in api.searches() {
            let (search, scope) = (search.clone(), scope.clone());
            let call: SearchCall = Rc::new(move |host: &dyn Host, query: &str, options: &[abi::SelectOption]| {
                scope.call("search", host, |read| search(read, query, options))
            });
            setup.registration.searches.push((name.clone(), call));
        }
        // The layers of setup are the plugin's, each with its own handler.
        for (layer, handler) in api.layers() {
            let deliver = scope.deliver(handler.clone());
            scope.owners.input.register(&**setup.host(), std::slice::from_ref(layer), &deliver);
        }
        for surface in api.surfaces() {
            let called = scope.clone();
            let call: surface::Call = Rc::new(move |export, host, owner, view| {
                called.call_as(owner, export, host, |read| view(read)).is_some()
            });
            let input = Rc::new(surface::Input {
                plugin: setup.id().to_owned(),
                deliver: surface.handler.clone().map(|handler| scope.deliver(handler)),
                layers: surface.layers.clone(),
                panel: matches!(surface.place, abi::v2::Place::Panel(_)),
                mounts: surface.mounts,
                activation: scope.owners.input.clone(),
            });
            let failing = scope.clone();
            let fail: surface::Fail = Rc::new(move |error| {
                let revoked = failing.revoked.take();
                crate::fail(&failing.host, &failing.id, &failing.failure, revoked, &failing.activation, error);
            });
            // A route's commands belong to each of its mounts, so what they ask for ends with that mount.
            let routed: Vec<(abi::Command, abi::CommandFn)> = match &surface.place {
                abi::v2::Place::Route(name) => api
                    .commands()
                    .filter(|(command, _)| matches!(&command.scope, abi::Scope::Route(route) if route == name))
                    .map(|(command, run)| (command.clone(), run.clone()))
                    .collect(),
                abi::v2::Place::Slot(_) | abi::v2::Place::Panel(_) | abi::v2::Place::Overlay(_) => Vec::new(),
            };
            // P3: `layout` and the scroll handler run as calls of the plugin, as its view does.
            let laying = scope.clone();
            let calls = behave::Calls {
                plugin: setup.id().to_owned(),
                layout: surface.layout.clone().map(|layout| {
                    Rc::new(move |geometry: &abi::v2::Geometry| {
                        let Some(host) = laying.host.upgrade() else { return abi::v2::LayoutReply::default() };
                        laying.call("layout", &*host, |_| layout(geometry)).unwrap_or_default()
                    }) as abi::v2::LayoutFn
                }),
                ended: Some({
                    let scope = scope.clone();
                    Rc::new(move || scope.failure.borrow().is_some() || scope.activation.disposed())
                        as Rc<dyn Fn() -> bool>
                }),
            };
            let owning = scope.clone();
            let commands: surface::Commands = Rc::new(move |alive: &Weak<()>| {
                routed
                    .iter()
                    .map(|(command, run)| {
                        let (run, scope, alive) = (run.clone(), owning.clone(), alive.clone());
                        tui_command(command, move |input| {
                            scope.run_owned(&alive, "run-command", |host| run(host, input));
                        })
                    })
                    .collect()
            });
            let viewer: Rc<dyn surface::Viewer> =
                Rc::new(surface::Linked::new(surface.view.clone(), surface.draw.clone(), call));
            let place = surface::Place {
                name: surface.name.clone(),
                at: surface.place.clone(),
                palette: surface.palette,
                notify: surface.notify.clone(),
            };
            setup.surface(place, viewer, commands, fail, calls, &scope.owners, input);
        }
        for claim in api.claims() {
            let called = scope.clone();
            // A claim's view reads the part's mount as `Read::mount`, as over the C ABI.
            let call: claim::Call = Rc::new(move |host, mount, view| {
                match called.owners.for_mount(mount, || called.call_timed("view", host, |read| view(read))) {
                    (None, _) => claim::Called::Failed,
                    (Some(()), true) => claim::Called::Overran,
                    (Some(()), false) => claim::Called::Returned,
                }
            });
            setup.renderer_claim(claim.into(), Rc::new(claim::Linked::new(claim.view.clone(), call)), &scope.owners);
        }
        // Disposal removes the plugin's commands, runs its dispose callbacks, then drops its replies and wakes.
        setup.on_dispose(move || scope.dispose(&mut api));
        Ok(())
    });
    definition.error = Some(error);
    definition
}

/// The keymap command of a plugin's `command`, which calls `run` with its input. It runs for the user's input unless
/// a plugin effect dispatched it ([`flush`]): a command the plugin runs itself, or one a reply or a result runs.
pub(crate) fn tui_command(command: &abi::Command, run: impl Fn(Option<&str>) + 'static) -> TuiCommand {
    keyed_command(command, move |input, _| run(input))
}

/// [`tui_command`] whose `run` also gets the key that ran it, if a key did.
pub(crate) fn keyed_command(
    command: &abi::Command,
    run: impl Fn(Option<&str>, Option<&KeyEvent>) + 'static,
) -> TuiCommand {
    let mut entry = TuiCommand::new(command.name.clone(), move |input, key| {
        behave::as_user(!FLUSHING.with(Cell::get), || run(input, key));
    })
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
    /// What a panic revokes at once, before deactivation: the commands' keymap layer and the event and delta
    /// subscriptions.
    revoked: RefCell<Vec<Disposer>>,
    /// The mount the running call belongs to, while a command of a 2.0 surface's route runs: what it asks for, such
    /// as a fetch, ends with that mount. `None` for the plugin's own calls, whose work lives with the plugin.
    mount: RefCell<Option<Weak<()>>>,
    monitor: Rc<contain::Monitor>,
    slot: contain::Slot,
    /// What its calls hold of the input (P2).
    owners: Rc<Owners>,
    /// An external plugin on an in-process carrier (Luau): an overrun fails it, as it fails a library; a built-in's is
    /// a host bug.
    external: bool,
}

/// Mounts an overlay surface into its frame.
type OverlayFn = Rc<dyn Fn(&dyn Host, &View) -> Option<Box<dyn Claimed>>>;

/// The mount a call is of closed: what it asks of the input applies nowhere (carbon own-1).
#[derive(Debug)]
struct Closed;

/// What a plugin's calls hold of the input (P2), on either carrier: the owner of the running call, the activation's own,
/// and the overlay surfaces. Its verbs are effects, which run once the call returns.
pub(crate) struct Owners {
    id: String,
    activation: Rc<Activation>,
    /// The input owner of the running call: a mount's while its view or handler runs; else [`Owners::input`].
    current: RefCell<Option<Rc<interact::Owner>>>,
    /// The mount of the running call that has no input owner: a claimed part's, while its view runs.
    called: RefCell<Option<abi::v2::MountId>>,
    /// The mount the running call's requests belong to, when no input owner of its runs: a 2.0 route's command's, or
    /// the mount of an input owner that went before its call's effects applied (the pipe).
    owned: RefCell<Option<Weak<()>>>,
    /// The activation's own input owner: the layers of its setup, and what a command asks for.
    input: Rc<interact::Owner>,
    /// The plugin's overlay surfaces, by name, each mounting into the frame the host gives it.
    overlays: RefCell<Vec<(String, OverlayFn)>>,
}

impl Owners {
    pub(crate) fn new(id: &str, host: Weak<dyn Host>, activation: &Rc<Activation>) -> Rc<Self> {
        let input = interact::Owner::activation(id, host);
        activation.own(&input);
        Rc::new(Self {
            id: id.to_owned(),
            activation: activation.clone(),
            current: RefCell::default(),
            called: RefCell::default(),
            owned: RefCell::default(),
            input,
            overlays: RefCell::default(),
        })
    }

    /// Runs `f` as a call of `owner`, a mount: what it reads and asks of the input is that mount's.
    pub(crate) fn as_owner<R>(&self, owner: &Rc<interact::Owner>, f: impl FnOnce() -> R) -> R {
        let outer = self.current.replace(Some(owner.clone()));
        let result = f();
        *self.current.borrow_mut() = outer;
        result
    }

    /// Runs `f` as a call of the mount `alive` stands for: what it asks for is that mount's.
    pub(crate) fn owned_by<R>(&self, alive: &Weak<()>, f: impl FnOnce() -> R) -> R {
        let outer = self.owned.replace(Some(alive.clone()));
        let result = f();
        *self.owned.borrow_mut() = outer;
        result
    }

    /// The mount that owns a request the running call makes (a fetch, a program): its route's for a route's command,
    /// its input owner's for a handler; `None` for the activation's own calls (setup, a global command, an event),
    /// whose requests are the activation's. Its reply comes only while the owner lives (bigboi's last pass).
    pub(crate) fn owning(&self) -> Option<Weak<()>> {
        self.owned.borrow().clone().or_else(|| self.mounted())
    }

    /// The mount the running call is of: its input owner, else the owner of the mount it belongs to (a route's
    /// command, or an input whose owner went before its effects applied); `Err` when that mount closed, whose call
    /// then affects nothing, neither the activation nor a mount opened since (carbon own-1); `Ok(None)` for the
    /// activation's own calls.
    fn mount_owner(&self) -> Result<Option<Rc<interact::Owner>>, Closed> {
        if let Some(current) = self.current.borrow().clone() {
            return Ok(Some(current));
        }
        let Some(owned) = self.owned.borrow().clone() else { return Ok(None) };
        let mounts = self.activation.owners();
        let own = mounts.into_iter().find(|owner| owner.mounted().is_some_and(|mount| Weak::ptr_eq(&mount, &owned)));
        own.map(Some).ok_or(Closed)
    }

    /// The input owner of the running call: its mount's, or the activation's.
    fn owner(&self) -> Result<Rc<interact::Owner>, Closed> {
        Ok(self.mount_owner()?.unwrap_or_else(|| self.input.clone()))
    }

    /// The owner a call's node `id` belongs to: the running call's mount, or, for a call of the plugin's own (a
    /// command), its newest mount whose tree holds the id.
    fn owner_of(&self, id: &str) -> Result<Rc<interact::Owner>, Closed> {
        if let Some(own) = self.mount_owner()? {
            return Ok(own);
        }
        let mounts = self.activation.owners();
        Ok(mounts.into_iter().rev().find(|owner| owner.has(id)).unwrap_or_else(|| self.input.clone()))
    }

    /// The owner a call's focus is about: the running call's mount, or, for a call of the plugin's own (a command), its
    /// newest mount that has the focus.
    fn owner_focused(&self) -> Result<Rc<interact::Owner>, Closed> {
        if let Some(own) = self.mount_owner()? {
            return Ok(own);
        }
        let mounts = self.activation.owners().into_iter().rev();
        Ok(mounts.into_iter().find(|owner| owner.focused().surface).unwrap_or_else(|| self.input.clone()))
    }

    pub(crate) fn rect(&self, id: &str) -> Option<abi::interact::Rect> {
        self.owner_of(id).ok()?.rect(id)
    }

    /// The ID of the running call's mount (big-boi 4).
    pub(crate) fn mount_id(&self) -> Option<abi::v2::MountId> {
        let owned = self.current.borrow().as_ref().and_then(|owner| owner.id().cloned());
        owned.or_else(|| self.called.borrow().clone())
    }

    /// Runs `f` as a call for `mount`, which has no input owner: [`Owners::mount_id`] names it.
    pub(crate) fn for_mount<R>(&self, mount: &abi::v2::MountId, f: impl FnOnce() -> R) -> R {
        let outer = self.called.replace(Some(mount.clone()));
        let result = f();
        *self.called.borrow_mut() = outer;
        result
    }

    /// The mount of the running call's owner: the one a verb or a read of its scrolls names (P3).
    pub(crate) fn mounted(&self) -> Option<Weak<()>> {
        self.current.borrow().as_ref().and_then(|owner| owner.mounted())
    }

    pub(crate) fn focused(&self) -> abi::interact::Focused {
        self.owner_focused().map(|owner| owner.focused()).unwrap_or_default()
    }

    pub(crate) fn mode(&self) -> Option<String> {
        self.owner().ok()?.mode()
    }

    pub(crate) fn open_panel(&self, open: abi::interact::OpenPanel) -> Effect {
        let id = self.id.clone();
        Box::new(move |host| host.open_panel(&id, &open))
    }

    pub(crate) fn close_panel(&self, surface: &str) -> Effect {
        let (id, surface) = (self.id.clone(), surface.to_owned());
        Box::new(move |host| host.close_panel(&id, &surface))
    }

    /// `None` when the plugin has no such overlay surface.
    pub(crate) fn overlay(&self, overlay: abi::interact::Overlay) -> Option<Effect> {
        let open = self.overlays.borrow().iter().find(|(name, _)| *name == overlay.surface).map(|(_, f)| f.clone());
        let Some(open) = open else {
            log::warn!("plugin {}: no overlay surface {:?}", self.id, overlay.surface);
            return None;
        };
        let Ok(opener) = self.owner() else { return Some(Box::new(|_| {})) };
        let id = self.id.clone();
        Some(Box::new(move |host| {
            if let Some(router) = host.router().filter(|_| opener.alive()) {
                router.open(host, &id, &overlay, &opener, |frame| open(host, frame));
            }
        }))
    }

    pub(crate) fn close_overlay(&self, surface: &str) -> Effect {
        let (id, surface) = (self.id.clone(), surface.to_owned());
        Box::new(move |host| {
            if let Some(router) = host.router() {
                router.close(host, &id, &surface, false);
            }
        })
    }

    pub(crate) fn focus(&self, node: &str) -> Effect {
        let Ok(owner) = self.owner_of(node) else { return Box::new(|_| {}) };
        let node = node.to_owned();
        Box::new(move |host| owner.focus(host, &node))
    }

    pub(crate) fn blur(&self) -> Effect {
        let Ok(owner) = self.owner_focused() else { return Box::new(|_| {}) };
        Box::new(move |host| owner.blur(host))
    }

    pub(crate) fn set_mode(&self, mode: Option<&str>) -> Effect {
        let Ok(owner) = self.owner() else { return Box::new(|_| {}) };
        let mode = mode.map(str::to_owned);
        Box::new(move |host| owner.set_mode(host, mode.as_deref()))
    }

    pub(crate) fn release_keys(&self) -> Effect {
        let id = self.id.clone();
        Box::new(move |host| {
            if let Some(router) = host.router() {
                router.release_for(&id);
            }
        })
    }
}

/// What one call of an in-process plugin asked for: the effects that wait for it to return, the storage it wrote, and
/// what its verbs staged.
#[derive(Default)]
struct Call {
    /// What the call asked for, each with whether its room is reserved: an effect that answers an ID the call was
    /// given (a fetch) is admitted past the queue's bound ([`has_room`]).
    effects: Vec<(Effect, bool)>,
    undo: Undo,
    staged: Staged,
}

pub(crate) type Effect = Box<dyn FnOnce(&dyn Host)>;

impl Scope {
    /// The host's names of storage key `key`, when the plugin declared it ([`storage::name`]).
    fn stored(&self, key: &str) -> Option<storage::Name> {
        if !self.keys.borrow().iter().any(|known| known == key) {
            log::warn!("plugin {}: storage key {key} was not declared", self.id);
            return None;
        }
        storage::name(&self.id, key).map_err(|error| log::warn!("plugin {}: {error}", self.id)).ok()
    }

    /// Calls `f` as one call of the plugin, `export`, unless it failed or its activation ended, as a claim still mounted
    /// after a disable may ask: a panic fails it. The call is timed; an overrun of a built-in is a host bug, which fails
    /// no plugin (synthesis 4.4).
    fn call<R>(self: &Rc<Self>, export: &'static str, host: &dyn Host, f: impl FnOnce(&Scoped<'_>) -> R) -> Option<R> {
        self.call_timed(export, host, f).0
    }

    /// [`Scope::call`], and whether the call took longer than the overrun limit.
    fn call_timed<R>(
        self: &Rc<Self>,
        export: &'static str,
        host: &dyn Host,
        f: impl FnOnce(&Scoped<'_>) -> R,
    ) -> (Option<R>, bool) {
        let (mut f, mut value) = (Some(f), None);
        let overrun = self.call_erased(export, host, &mut |scoped| value = f.take().map(|f| f(scoped)));
        (value, overrun)
    }

    /// [`Scope::call_timed`] with the result left to the caller, so one copy serves every result type. `f` sets it
    /// only when it returns.
    fn call_erased(self: &Rc<Self>, export: &'static str, host: &dyn Host, f: &mut dyn FnMut(&Scoped<'_>)) -> bool {
        if self.failure.borrow().is_some() || self.activation.disposed() {
            return false;
        }
        let (out, timed) = self.monitor.call(self.slot, export, || behave::calling(export, || self.attempt(host, f)));
        let panicked = matches!(out, Some(Err(_)));
        budget(&self.host, &self.monitor, &self.id, &timed, panicked || (timed.overrun && self.external));
        if timed.overrun && !self.external {
            self.monitor.host_overran();
            let took = timed.cpu.unwrap_or(timed.took).as_millis();
            log::error!("plugin {}: {export} took {took} ms, a host bug in a built-in", self.id);
        }
        let error = match out {
            Some(Err(panic)) => Some(format!("{export} panicked: {panic}")),
            // A call that returned late did return: what it asked for happens, then it fails, as over the C ABI.
            _ if timed.overrun && self.external => {
                let limit = self.monitor.limits().overrun.as_millis();
                Some(match timed.cpu {
                    Some(cpu) => format!("{export} used {} ms of CPU, over the limit of {limit} ms", cpu.as_millis()),
                    None => format!("{export} took {} ms, over the limit of {limit} ms", timed.took.as_millis()),
                })
            }
            _ => None,
        };
        if let Some(error) = error {
            let revoked = self.revoked.take();
            fail(&self.host, &self.id, &self.failure, revoked, &self.activation, error);
        }
        timed.overrun
    }

    /// Calls `f` with the host as the plugin reads and calls it. What it asks for waits on the effect queue until it
    /// returns; when it panics, that is dropped, the storage it wrote is put back, and the panic's message returned.
    /// `None` when the host never read.
    fn attempt<R>(self: &Rc<Self>, host: &dyn Host, f: impl FnOnce(&Scoped<'_>) -> R) -> Option<Result<R, String>> {
        // A call within a call sees what the outer one staged.
        let staged = self.call.borrow().as_ref().map(|call| call.staged.clone()).unwrap_or_default();
        let outer = self.call.replace(Some(Call { staged, ..Call::default() }));
        let (mut f, mut out) = (Some(f), None);
        host.read(&mut |read| {
            if let Some(f) = f.take() {
                out = Some(contain::catch(|| f(&Scoped { read, host, scope: self })));
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
                outer.staged = call.staged;
            }
            (_, None) => call.effects.into_iter().for_each(|(effect, reserved)| match reserved {
                true => defer(&self.host, effect),
                false => request(&self.host, &self.id, effect),
            }),
        }
        out
    }

    /// Runs a handler of the plugin with the host, then invalidates its claims, whose state it may have changed.
    fn run(self: &Rc<Self>, export: &'static str, handler: impl FnOnce(&Scoped<'_>)) {
        let Some(host) = self.host.upgrade() else { return };
        if self.call(export, &*host, handler).is_some() {
            self.activation.invalidate();
        }
    }

    /// [`Scope::call`] for a call of `owner`, a mount: what it reads and asks of the input is that mount's.
    fn call_as<R>(
        self: &Rc<Self>,
        owner: &Rc<interact::Owner>,
        export: &'static str,
        host: &dyn Host,
        f: impl FnOnce(&Scoped<'_>) -> R,
    ) -> Option<R> {
        self.owners.as_owner(owner, || self.call(export, host, f))
    }

    /// What delivers an event to `handler` as one call of the plugin, for the owner it is routed to; the plugin's
    /// surfaces draw again after it.
    fn deliver(self: &Rc<Self>, handler: abi::interact::HandlerFn) -> interact::Deliver {
        let scope = Rc::downgrade(self);
        Rc::new(move |host: &dyn Host, owner: &Rc<interact::Owner>, event: &abi::interact::Event| {
            let Some(scope) = scope.upgrade() else { return abi::interact::Handled::Pass };
            // Owned by the mount it reaches: what it asks for (a fetch, a scroll verb) ends with that mount.
            let outer = scope.mount.replace(owner.mounted());
            let handled = scope.call_as(owner, "handle", host, |host| handler(host, event));
            *scope.mount.borrow_mut() = outer;
            if handled.is_some() {
                scope.activation.invalidate();
            }
            handled.unwrap_or(abi::interact::Handled::Pass)
        })
    }

    /// [`Scope::run`] for a command that belongs to the mount `alive` stands for.
    fn run_owned(self: &Rc<Self>, alive: &Weak<()>, export: &'static str, handler: impl FnOnce(&Scoped<'_>)) {
        if alive.upgrade().is_none() {
            return;
        }
        let outer = self.mount.replace(Some(alive.clone()));
        // What it asks of the input is the mount's too, as on the other carriers (carbon own-1).
        self.owners.owned_by(alive, || self.run(export, handler));
        *self.mount.borrow_mut() = outer;
    }

    /// Runs a mount handler: a claim or route may mount and unmount after its plugin was disposed, which hears of it
    /// no more.
    fn mounted(self: &Rc<Self>, export: &'static str, handler: impl FnOnce(&Scoped<'_>)) {
        if !self.activation.disposed() {
            self.run(export, handler);
        }
    }

    /// Ends the activation, so no call, reply or wake reaches the plugin after, then disposes its registrations `api`
    /// with the host, or without it once it is gone. A plugin that failed is called no more, so its dispose callbacks
    /// do not run (4.14; TS runs no plugin code after a failed setup either).
    fn dispose(self: &Rc<Self>, api: &mut abi::Registered) {
        self.revoked.take().into_iter().for_each(Disposer::dispose);
        // First, so nothing the dispose callbacks set off calls the plugin back.
        self.activation.dispose();
        if self.failure.borrow().is_some() {
            api.abandon();
            return;
        }
        let host = self.host.upgrade();
        let (disposed, _) = self
            .monitor
            .call(self.slot, "dispose", || host.and_then(|host| self.attempt(&*host, |host| api.dispose(Some(host)))));
        if disposed.is_none() {
            api.dispose(None);
        }
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

    fn pending(&self, id: &str) -> Vec<abi::types::SessionInboxInfo> {
        self.read.pending(id)
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
        let json = storage::read(self.host, &self.scope.stored(key)?)?;
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

    fn composer(&self) -> Option<abi::Composer> {
        self.read.composer()
    }

    fn variants(&self) -> Vec<String> {
        self.read.variants()
    }

    fn tabs_enabled(&self) -> bool {
        self.read.tabs_enabled()
    }

    fn tabs(&self) -> Vec<abi::Tab> {
        self.read.tabs()
    }

    fn keymap_pending(&self) -> Vec<abi::KeymapPending> {
        self.read.keymap_pending()
    }

    fn keymap_active(&self) -> Vec<abi::KeymapActive> {
        self.read.keymap_active()
    }

    fn keymap_commands(&self) -> Vec<abi::KeymapCommand> {
        self.read.keymap_commands()
    }

    fn shortcuts(&self, name: &str) -> Vec<String> {
        self.read.shortcuts(name)
    }

    fn selection(&self) -> Option<String> {
        self.read.selection()
    }

    fn theme(&self) -> Option<String> {
        self.read.theme()
    }

    fn themes(&self) -> Vec<String> {
        self.read.themes()
    }

    fn plugins(&self) -> Vec<abi::PluginEntry> {
        self.read.plugins()
    }

    fn setting(&self, name: &str) -> Option<serde_json::Value> {
        self.read.setting(name)
    }

    fn image_size(&self, bytes: &[u8]) -> Option<(u32, u32)> {
        self.read.image_size(bytes)
    }

    fn scroll_state(&self, target: &abi::v2::Target) -> Option<abi::v2::ScrollState> {
        behave::scroll_state(&self.caller(), target)
    }

    fn anchors(&self, target: &abi::v2::Target, group: &str) -> Vec<abi::v2::AnchorAt> {
        behave::anchors(&self.caller(), target, group)
    }

    fn top_anchor(&self, target: &abi::v2::Target, group: &str, inset: u16) -> Option<abi::v2::AnchorAt> {
        behave::top_anchor(&self.caller(), target, group, inset)
    }

    fn transcript(&self) -> Option<abi::v2::TranscriptView> {
        behave::transcript(self.host.app())
    }

    fn rect(&self, id: &str) -> Option<abi::interact::Rect> {
        self.scope.owners.rect(id)
    }

    fn focused(&self) -> abi::interact::Focused {
        self.scope.owners.focused()
    }

    fn mode(&self) -> Option<String> {
        self.scope.owners.mode()
    }

    fn mount(&self) -> Option<abi::v2::MountId> {
        self.scope.owners.mount_id()
    }
}

impl abi::Host for Scoped<'_> {
    fn scroll(&self, target: abi::v2::Target, verb: abi::v2::Scroll) {
        // A verb on the transcript answers the user's input to this plugin (decision 8): from a view, `layout`, a
        // wake or a reply it would fight the user's wheel, or loop through the transcript's own `layout` call.
        if target == abi::v2::Target::Transcript && !behave::in_handler() {
            log::warn!("plugin {}: a transcript verb outside a handler of the user's input is dropped", self.scope.id);
            return;
        }
        // The mount it names is the one of this call, found now: a verb for a mount closed before it applies is
        // dropped.
        let effect = behave::scroll(&self.caller(), target, verb);
        self.defer(move |_| effect());
    }

    fn storage_set(&self, key: &str, value: serde_json::Value) {
        let Some(stored) = self.scope.stored(key) else { return };
        let json = value.to_string();
        let written = storage::bounded(json.len()).and_then(|()| {
            self.written(&stored.now);
            // The host shows it to reads at once; the claims hear of it in queue order.
            self.host.storage_write(&stored.now, &json)
        });
        match written {
            Ok(()) => self.defer(|host| host.storage_changed()),
            Err(error) => log::warn!("storage {}: {error}", stored.now),
        }
    }

    fn storage_merge(&self, key: &str, fields: serde_json::Map<String, serde_json::Value>) {
        let Some(stored) = self.scope.stored(key) else { return };
        let merged = storage::bounded_merge(self.host, &stored, &fields).and_then(|()| {
            self.written(&stored.now);
            storage::migrate(self.host, &stored)?;
            self.host.storage_merge(&stored.now, fields)
        });
        match merged {
            Ok(()) => self.defer(|host| host.storage_changed()),
            Err(error) => log::warn!("storage {}: {error}", stored.now),
        }
    }

    fn dispatch(&self, name: &str, input: Option<&str>) {
        let (name, input) = (name.to_owned(), input.map(str::to_owned));
        self.defer(move |host| dispatch(host, &name, input.as_deref()));
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
        self.try_fetch(fetch).unwrap_or(abi::RequestId(0))
    }

    fn try_fetch(&self, fetch: abi::Fetch) -> Result<abi::RequestId, String> {
        self.request(move |host, reply| host.fetch(fetch, reply))
    }

    fn dialog(&self, dialog: abi::Dialog) {
        let (id, generation) = (self.scope.id.clone(), self.scope.generation);
        self.defer(move |host| host.dialog(&id, generation, dialog));
    }

    fn copy(&self, text: &str, then: Option<abi::Action>) {
        let text = text.to_owned();
        self.defer(move |host| copy(host, &text, then));
    }

    fn edit_composer(&self, edit: abi::ComposerEdit) {
        self.defer(move |host| host.edit_composer(edit));
    }

    fn open_panel(&self, open: abi::interact::OpenPanel) {
        self.defer(self.scope.owners.open_panel(open));
    }

    fn close_panel(&self, surface: &str) {
        self.defer(self.scope.owners.close_panel(surface));
    }

    fn overlay(&self, overlay: abi::interact::Overlay) {
        if let Some(effect) = self.scope.owners.overlay(overlay) {
            self.defer(effect);
        }
    }

    fn close_overlay(&self, surface: &str) {
        self.defer(self.scope.owners.close_overlay(surface));
    }

    fn focus(&self, node: &str) {
        self.defer(self.scope.owners.focus(node));
    }

    fn blur(&self) {
        self.defer(self.scope.owners.blur());
    }

    fn set_mode(&self, mode: Option<&str>) {
        self.defer(self.scope.owners.set_mode(mode));
    }

    fn release_keys(&self) {
        self.defer(self.scope.owners.release_keys());
    }

    fn checkpoint(&self) -> Option<u64> {
        self.scope.call.borrow().as_ref().map(|call| mark(call.effects.len(), call.undo.0.len()))
    }

    fn rollback(&self, at: u64) {
        let (effects, writes) = marked(at);
        if let Some(call) = &mut *self.scope.call.borrow_mut() {
            call.effects.truncate(effects);
            call.undo.restore_after(self.host, writes);
        }
    }

    fn set_variant(&self, variant: Option<&str>) -> bool {
        let known = self.staged(|staged| staged.variant_known(self.read, variant));
        if known {
            let variant = variant.map(str::to_owned);
            self.defer(move |host| host.set_variant(variant.as_deref()));
        }
        known
    }

    fn set_model(&self, provider: &str, model: &str) {
        self.staged(|staged| staged.set_model(self.read, provider, model));
        let (provider, model) = (provider.to_owned(), model.to_owned());
        self.defer(move |host| host.set_model(&provider, &model));
    }

    fn edit_tab(&self, edit: abi::TabEdit) -> bool {
        let allowed = self.staged(|staged| staged.tab(self.host, &edit));
        if allowed {
            self.defer(move |host| host.edit_tab(edit));
        }
        allowed
    }

    fn clear_selection(&self) {
        self.defer(|host| host.clear_selection());
    }

    fn foreground(&self, program: abi::Foreground) -> abi::RequestId {
        self.try_foreground(program).unwrap_or(abi::RequestId(0))
    }

    fn try_foreground(&self, program: abi::Foreground) -> Result<abi::RequestId, String> {
        // The program starts later, once the turn is done: only if its plugin is still active then, and the mount that
        // owns it is still open (bigboi's freeze pass).
        let (owner, mount) = (Rc::downgrade(self.scope), self.scope.mount.borrow().clone());
        let alive = Box::new(move || {
            let active =
                owner.upgrade().is_some_and(|scope| !scope.activation.disposed() && scope.failure.borrow().is_none());
            active && mount.as_ref().is_none_or(|mount| mount.upgrade().is_some())
        });
        self.request(move |host, reply| host.foreground(program, alive, reply))
    }

    fn set_title(&self, title: &str) {
        let title = title.to_owned();
        self.defer(move |host| host.set_title(&title));
    }

    fn set_theme(&self, name: &str) -> bool {
        let known = self.staged(|staged| staged.theme_known(self.read, name));
        if known {
            let name = name.to_owned();
            self.defer(move |host| host.set_theme(&name));
        }
        known
    }

    fn install_theme(&self, name: &str, theme: serde_json::Value) {
        if self.staged(|staged| staged.install_theme(name, &theme)) {
            let name = name.to_owned();
            self.defer(move |host| host.install_theme(&name, theme));
        }
    }

    fn set_setting(&self, name: &str, value: serde_json::Value) {
        let name = name.to_owned();
        self.defer(move |host| host.set_setting(&name, value));
    }

    fn declare_storage_key(&self, key: &str) {
        if let Err(error) = storage::declare(&mut self.scope.keys.borrow_mut(), key) {
            log::warn!("plugin {}: {error}", self.scope.id);
        }
    }
}

/// Copies `text`, then runs `then` once it is copied.
pub(crate) fn copy(host: &dyn Host, text: &str, then: Option<abi::Action>) {
    if let (true, Some(abi::Action::Command { name, input })) = (host.copy(text), then) {
        dispatch(host, &name, input.as_deref());
    }
}

/// What the verbs of one call changed that a later verb of the same call checks, as TS acts on each verb in order:
/// the model it selected, the tab edits it made and the themes it installed. It goes with the call's effects, so a
/// call that panics leaves nothing staged.
#[derive(Clone, Default)]
pub(crate) struct Staged {
    /// The model [`abi::Host::set_model`] selected, when the host lists it.
    model: Option<(String, String)>,
    tabs: Vec<abi::TabEdit>,
    themes: Vec<String>,
}

impl Staged {
    /// [`abi::Host::set_model`]: a model the host lists is the selected one for the rest of the call.
    pub(crate) fn set_model(&mut self, read: &dyn abi::Read, provider: &str, model: &str) {
        if listed(read, provider, model).is_some() {
            self.model = Some((provider.to_owned(), model.to_owned()));
        }
    }

    /// Whether [`abi::Host::set_variant`] selects `variant`: a model is selected, and it has `variant` (TS
    /// `ui.model.variant.set`).
    pub(crate) fn variant_known(&self, read: &dyn abi::Read, variant: Option<&str>) -> bool {
        let Some((provider, model)) = &self.model else {
            return read.model().is_some()
                && variant.is_none_or(|variant| read.variants().iter().any(|known| known == variant));
        };
        let variants = listed(read, provider, model).map(|info| info.variants).unwrap_or_default();
        variant.is_none_or(|variant| variants.iter().any(|known| known.id == variant))
    }

    /// Whether [`abi::Host::edit_tab`] does `edit`, after the call's earlier edits; one it does is staged.
    pub(crate) fn tab(&mut self, host: &dyn Host, edit: &abi::TabEdit) -> bool {
        let allowed = host.tab_allowed(edit, &self.tabs);
        if allowed {
            self.tabs.push(edit.clone());
        }
        allowed
    }

    /// Whether [`abi::Host::set_theme`] selects theme `name`: the host has it, or the call installed it.
    pub(crate) fn theme_known(&self, read: &dyn abi::Read, name: &str) -> bool {
        self.themes.iter().any(|known| known == name) || read.themes().iter().any(|known| known == name)
    }

    /// Whether [`abi::Host::install_theme`] installs `theme` as `name`: a name that is a plain file name, and a theme
    /// document (one the TUI's theme catalog would keep). One it installs is staged.
    pub(crate) fn install_theme(&mut self, name: &str, theme: &serde_json::Value) -> bool {
        let valid = theme_file_name(name) && opencode_ui::theme::is_theme_source(theme);
        if !valid {
            log::warn!("a plugin installs a theme that is not one, or not as a plain file name: {name:?}");
        } else if !self.themes.iter().any(|known| known == name) {
            self.themes.push(name.to_owned());
        }
        valid
    }
}

/// Model `model` of provider `provider`, when the host lists it.
fn listed(read: &dyn abi::Read, provider: &str, model: &str) -> Option<abi::types::ModelInfo> {
    let models = read.models(None)?;
    models.into_iter().find(|info| info.provider_id.0 == provider && info.id == model)
}

/// Whether a theme name is safe as a file name in a themes directory: no path, and no hidden file.
pub fn theme_file_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && name.chars().all(|char| char.is_ascii_alphanumeric() || matches!(char, '-' | '_' | '.'))
}

/// A fresh [`abi::RequestId`], unique in the process.
pub(crate) fn next_request() -> abi::RequestId {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    abi::RequestId(NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed))
}

impl Scoped<'_> {
    /// Queues `send` like an effect, unless the plugin is disposed by then, and returns the ID its reply comes back to
    /// the plugin's [`abi::Setup::on_reply`] handlers with, on the effect queue, unless the plugin is disposed first;
    /// [`REFUSED`] without room for it.
    fn request(&self, send: impl FnOnce(&dyn Host, Reply) + 'static) -> Result<abi::RequestId, String> {
        // An ID is a promise of a reply: none is given unless the request's effect has room (bigboi's final pass).
        let staged = self.scope.call.borrow().as_ref().map_or(0, |call| call.effects.len());
        if !has_room(staged) {
            log::warn!("plugin {}: {REFUSED}", self.scope.id);
            return Err(REFUSED.to_owned());
        }
        let id = next_request();
        let scope = Rc::downgrade(self.scope);
        // A request a mount's command asked for ends with the mount: a reply for a mount that closed, also one opened
        // again since, is dropped when it arrives.
        let mount = self.scope.mount.borrow().clone();
        let live = move || mount.as_ref().is_none_or(|mount| mount.upgrade().is_some());
        self.defer_reserved(move |host| {
            if scope.upgrade().is_none_or(|scope| scope.activation.disposed()) || !live() {
                return;
            }
            send(
                host,
                Box::new(move |result| {
                    let Some(host) = scope.upgrade().map(|scope| scope.host.clone()) else { return };
                    // The reply runs on the effect queue, in order with the effects queued before it.
                    defer(&host, move |_| {
                        let Some(scope) = scope.upgrade().filter(|scope| !scope.activation.disposed()) else { return };
                        if !live() {
                            return;
                        }
                        let replies = scope.replies.borrow().clone();
                        scope.run("on-reply", |host| replies.iter().for_each(|run| run(host, id, result.clone())));
                    });
                }),
            );
        });
        Ok(id)
    }

    /// Who asks, for the behaviors: the host's app, the plugin, and the mount whose call runs.
    fn caller(&self) -> behave::Caller<'_> {
        behave::Caller { app: self.host.app(), plugin: &self.scope.id, mount: self.scope.mount.borrow().clone() }
    }

    /// Holds `effect` until the call returns.
    fn defer(&self, effect: impl FnOnce(&dyn Host) + 'static) {
        match &mut *self.scope.call.borrow_mut() {
            Some(call) => call.effects.push((Box::new(effect), false)),
            None => request(&self.scope.host, &self.scope.id, effect),
        }
    }

    /// [`Scoped::defer`] for an effect whose room [`has_room`] reserved: it is admitted past the queue's bound.
    fn defer_reserved(&self, effect: impl FnOnce(&dyn Host) + 'static) {
        match &mut *self.scope.call.borrow_mut() {
            Some(call) => call.effects.push((Box::new(effect), true)),
            None => defer(&self.scope.host, effect),
        }
    }

    /// Runs `f` with what the running call staged.
    fn staged<R>(&self, f: impl FnOnce(&mut Staged) -> R) -> R {
        match &mut *self.scope.call.borrow_mut() {
            Some(call) => f(&mut call.staged),
            None => f(&mut Staged::default()),
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

    /// How many writes it holds.
    pub(crate) fn len(&self) -> usize {
        self.0.len()
    }

    /// Puts back the writes after the first `kept`, the last first, and forgets them.
    pub(crate) fn restore_after(&mut self, host: &dyn Host, kept: usize) {
        Undo(self.0.split_off(kept.min(self.0.len()))).restore(host);
    }
}

/// A mark of a call's effects and storage writes so far, for [`abi::Host::rollback`].
pub(crate) fn mark(effects: usize, writes: usize) -> u64 {
    ((effects as u64) << 32) | writes as u64 & 0xffff_ffff
}

/// The effects and storage writes a mark of [`mark`] keeps.
pub(crate) fn marked(mark: u64) -> (usize, usize) {
    ((mark >> 32) as usize, (mark & 0xffff_ffff) as usize)
}

/// Fails plugin `id` with `error` after a call of it panicked: it is not called again, its commands leave the keymap
/// once the key that may have run the call is handled, as do its event and delta subscriptions (`revoked`), so the
/// host stops keeping work for it; the host says so, and its claims draw empty. Its activation ends: a wake, a fetch
/// it asked for in the same turn and a reply reach nothing.
pub(crate) fn fail(
    host: &Weak<dyn Host>,
    id: &str,
    failure: &RefCell<Option<String>>,
    revoked: Vec<Disposer>,
    activation: &Rc<Activation>,
    error: String,
) {
    // A failure is final, and the first cause is the one reported (4.14): a plugin that failed cannot fail again.
    if failure.borrow().is_some() {
        return;
    }
    log::error!("plugin {id} failed: {error}");
    *failure.borrow_mut() = Some(error);
    let id = id.to_owned();
    defer(host, move |host| {
        revoked.into_iter().for_each(Disposer::dispose);
        host.revoked(&id);
        host.failed(&id);
        // The fences it drew fall back to the code view, as the ones it draws from now on do.
        host.remount();
    });
    // The queued redraw still runs on a disposed activation, so the claims draw empty once. Disposing tells its threads
    // to end and drops what they sent (4.14: a wake for a plugin that is not active).
    activation.invalidate();
    activation.dispose();
}

/// A waiting effect, with its host and its depth: how many dispatches of effects led to it ([`dispatch`]).
type Queued = (Weak<dyn Host>, u32, Effect);

thread_local! {
    /// The plugins' effects that wait, in the order they were asked for, on both paths.
    static EFFECTS: RefCell<std::collections::VecDeque<Queued>> = RefCell::default();
    static FLUSHING: Cell<bool> = const { Cell::new(false) };
    /// The depth of what runs now: of the effect that runs, one more inside a dispatch it runs, 0 outside effects.
    static DEPTH: Cell<u32> = const { Cell::new(0) };
    /// The host and frame the effects run in, how many ran in that frame, and whether the next paint was asked for.
    static RAN: Cell<((usize, u64), usize, bool)> = const { Cell::new(((0, 0), 0, false)) };
}

/// An effect asked for under this many dispatches of effects, each by a command the one before ran (a command that
/// dispatches itself, a copy whose `then` runs it again), is dropped: each call is short, so no limit of a call ends
/// such a chain, and the UI thread would never read input again (review carbon-2). Other effects, such as a reply a
/// fetch got at once, keep the depth of the one that asked: only the frame's count bounds them.
const CHAIN: u32 = 64;
/// At most this many effects wait: a plugin's request past them is dropped, so a chain that fans out over frames
/// cannot grow the queue without bound (review carbon new-1). The host's own work is never dropped.
const QUEUE: usize = 1 << 16;
/// At most this many effects run in a frame; the rest waits for the next paint, so a chain that fans out, or many
/// answers that arrive at once, still let the UI read input and paint (reviews carbon-2, carbon new-1).
const FRAME_EFFECTS: usize = 1024;

/// Acts on what the budget said of a call of plugin `id`: a plugin that became slow is told once a session, unless the
/// call `failed` it, which tells its own report; a call that opened a frame has the frames closed at the next paint.
pub(crate) fn budget(
    host: &Weak<dyn Host>,
    monitor: &Rc<contain::Monitor>,
    id: &str,
    timed: &contain::Timed,
    failed: bool,
) {
    if let Some(cost) = timed.slow.clone().filter(|_| !failed) {
        let id = id.to_owned();
        defer(host, move |host| host.slow(&id, &cost));
    }
    if timed.opened && monitor.wants_close() {
        close_at_paint(host, monitor);
    }
}

/// Closes the frames before the one open as the next paint starts, before it counts its frame; while one over the
/// budget is still open, at the paint after too.
pub(crate) fn close_at_paint(host: &Weak<dyn Host>, monitor: &Rc<contain::Monitor>) {
    let Some(strong) = host.upgrade() else { return };
    let (host, monitor) = (host.clone(), monitor.clone());
    strong.app().animate(move |_, _| {
        for (id, cost) in monitor.close() {
            defer(&host, move |host| host.slow(&id, &cost));
        }
        // Every change of slow, not only the first one a session that a toast tells (review carbon-4). A frame of
        // plugin calls always ends here, at the paint, so a change is always seen here.
        if monitor.take_flipped() {
            defer(&host, |host| host.slow_changed());
        }
        if monitor.open_over() && monitor.wants_close() {
            close_at_paint(&host, &monitor);
        }
        false
    });
}

/// Queues `effect` on the host's one effect queue, which both paths share: it runs in order with every other plugin
/// effect, once the outermost plugin callback has returned and every UI and store borrow has ended, at the latest
/// when the host routes its next message ([`flush`]).
pub(crate) fn defer(host: &Weak<dyn Host>, effect: impl FnOnce(&dyn Host) + 'static) {
    let Some(strong) = host.upgrade() else { return };
    EFFECTS.with(|effects| effects.borrow_mut().push_back((host.clone(), DEPTH.get(), Box::new(effect))));
    // Each effect asks for a drain of its own, as each was deferred before; a drain finds the queue empty once an
    // earlier one or a message ran it.
    strong.app().defer(|_| flush());
}

/// Runs the plugins' waiting effects now, in order, with those they queue in turn. The host calls it as it routes a
/// message that runs plugin code or navigates (a store signal, a plugin's wake), outside every plugin callback and
/// borrow, so such a message never overtakes what a plugin asked for while handling the one before it (an OpenTUI
/// batch of messages runs before its deferred work).
pub fn flush() {
    if FLUSHING.with(|flushing| flushing.replace(true)) {
        return;
    }
    while let Some((host, depth, effect)) = next_effect() {
        if let Some(host) = host.upgrade() {
            let outer = DEPTH.replace(depth);
            behave::as_user(false, || effect(&*host));
            DEPTH.set(outer);
        }
    }
    FLUSHING.with(|flushing| flushing.set(false));
}

/// Whether a request's effect, after the `staged` effects of the call that asks, has room: under [`CHAIN`] and
/// [`QUEUE`]. A request is given an ID only then, and its effect is then admitted past the bound, so an ID always gets
/// its reply (bigboi's final pass); a request refused is an error, [`REFUSED`], on every carrier.
pub(crate) fn has_room(staged: usize) -> bool {
    DEPTH.get() <= CHAIN && EFFECTS.with(|effects| effects.borrow().len()).saturating_add(staged) < QUEUE
}

/// Why the host refuses a request that would be given an ID ([`has_room`]).
pub(crate) const REFUSED: &str = "the host takes no request now: the effects that wait fill its queue";

/// [`defer`] for what plugin `plugin` asked for, on every carrier, one entry an effect: dropped past [`CHAIN`] or
/// [`QUEUE`].
pub(crate) fn request(host: &Weak<dyn Host>, plugin: &str, effect: impl FnOnce(&dyn Host) + 'static) {
    let depth = DEPTH.get();
    if depth > CHAIN {
        log::warn!("plugin {plugin}: an effect asked for under {CHAIN} dispatches and events of effects was dropped");
        return;
    }
    if EFFECTS.with(|effects| effects.borrow().len()) >= QUEUE {
        log::warn!("plugin {plugin}: an effect was dropped, as {QUEUE} effects wait");
        return;
    }
    defer(host, effect);
}

/// How many effects wait on this thread, for the tests of [`QUEUE`].
#[doc(hidden)]
pub fn effects_waiting() -> usize {
    EFFECTS.with(|effects| effects.borrow().len())
}

/// Runs command `name` for an effect a plugin asked for: what it asks for in turn is one deeper ([`CHAIN`]).
pub(crate) fn dispatch(host: &dyn Host, name: &str, input: Option<&str>) {
    deeper(|| host.dispatch(name, input));
}

/// Runs `f`, a call into a plugin that what runs now causes (a dispatch, an event its input router sends it), one
/// deeper: what it asks for counts toward [`CHAIN`], so a chain through events, such as an overlay opened again as
/// the overlay it replaced tells it closed, ends too (review carbon new-1).
pub(crate) fn deeper<R>(f: impl FnOnce() -> R) -> R {
    let outer = DEPTH.get();
    DEPTH.set(outer + 1);
    let out = f();
    DEPTH.set(outer);
    out
}

/// The next effect to run, unless the queue is empty or [`FRAME_EFFECTS`] ran in this frame, whatever asked for them
/// (many answers of a carrier arrive in one turn): then the rest runs as the next paint starts (review carbon new-1).
fn next_effect() -> Option<Queued> {
    let next = EFFECTS.with(|effects| effects.borrow_mut().pop_front())?;
    // The effect of a host that is gone runs nothing.
    let Some(host) = next.0.upgrade() else { return Some(next) };
    let frame = (Rc::as_ptr(&host).cast::<()>() as usize, host.app().frame_number());
    let (count, asked) = match RAN.get() {
        (at, count, asked) if at == frame => (count, asked),
        _ => (0, false),
    };
    if count < FRAME_EFFECTS {
        RAN.set((frame, count + 1, asked));
        return Some(next);
    }
    EFFECTS.with(|effects| effects.borrow_mut().push_front(next));
    RAN.set((frame, count, true));
    if !asked {
        // Runs before the paint's deferred work: a new budget for the rest of this frame number, and a flush there.
        host.app().animate(move |cx, _| {
            RAN.set((frame, 0, false));
            cx.app().defer(|_| flush());
            false
        });
    }
    None
}

/// What a plugin registers while it is active: the host's side of a setup, on either path.
pub(crate) struct Setup<'a> {
    host: &'a Rc<dyn Host>,
    id: &'a str,
    registration: Registration,
    /// Times the plugin's calls.
    pub(crate) monitor: &'a Rc<contain::Monitor>,
    /// The external build it is, if it is one: its target and digest.
    artifact: Option<(&'a str, &'a str)>,
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

    /// The first activation of the chain this one goes on from, whose dialogs it owns ([`Registry::owns`]).
    pub(crate) fn continues(&mut self, since: Option<u64>) {
        self.registration.continues = since;
    }

    /// Tells the registry how to learn that a call of this activation panicked: then it contributes nothing more.
    pub(crate) fn failure(&mut self, failure: ErrorFn) {
        self.registration.failure = Some(failure);
    }

    /// What the activation runs as the plugins the host lists change: the plugin's `on_plugins` handlers (P6b).
    pub(crate) fn on_plugins(&mut self, run: Rc<dyn Fn()>) {
        self.registration.plugins = Some(run);
    }

    /// What the record names this plugin's calls by.
    pub(crate) fn artifact(&self) -> contain::Artifact {
        match self.artifact {
            Some((target, digest)) => contain::Artifact::external(self.id, target, digest),
            None => contain::Artifact::builtin(self.id),
        }
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
    /// again, `mount` hears of each mount and unmount, and a `sized` claim renders again when its size changes.
    pub(crate) fn claim(
        &mut self,
        placement: Placement,
        render: node::SlotRender,
        mount: Option<node::MountFn>,
        sized: bool,
        activation: &Rc<Activation>,
    ) {
        let owner = Rc::downgrade(self.host);
        let path = placement.target.clone();
        let activation = activation.clone();
        let charge = self.charge();
        self.slot(placement, move |host, input| {
            let (render, mount, charge) = (render.clone(), mount.clone(), charge.clone());
            let mount = node::Mount::new(host, owner.clone(), &path, input, render, mount, sized, charge);
            activation.track(Rc::downgrade(&mount) as Weak<dyn Drawn>);
            Box::new(mount)
        });
    }

    /// The plugin a mount of ABI 1.x is charged to, and what times the host's work for it (review carbon 2.4).
    fn charge(&self) -> node::Charge {
        let (monitor, slot) = (self.monitor.clone(), self.monitor.slot(&self.artifact()));
        (Rc::from(self.id), Rc::new(move |work| monitor.host(slot, work)))
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
        let charge = self.charge();
        self.route(name, move |host| {
            let (view, mounted) =
                route::View::new(host, owner.clone(), render.clone(), commands.clone(), mount.clone(), charge.clone());
            activation.track(Rc::downgrade(&mounted) as Weak<dyn Drawn>);
            Box::new(view)
        });
    }

    /// Registers a surface of contract 2.0, on any place: each showing is a new mount ([`surface::Surface`]), whose
    /// views run through `call`; the activation of `owners` draws its mounts again, and an overlay is one of `owners`.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn surface(
        &mut self,
        surface: surface::Place,
        viewer: Rc<dyn surface::Viewer>,
        commands: surface::Commands,
        fail: surface::Fail,
        calls: behave::Calls,
        owners: &Owners,
        input: Rc<surface::Input>,
    ) {
        let (owner, activation) = (Rc::downgrade(self.host), owners.activation.clone());
        let plugin: Rc<str> = Rc::from(self.id);
        // The host's work for the plugin's nodes is timed apart from its calls, as its host time (4.4).
        let (monitor, slot) = (self.monitor.clone(), self.monitor.slot(&self.artifact()));
        let host_time: surface::HostTime = Rc::new(move |work| monitor.host(slot, work));
        match surface.at.clone() {
            abi::v2::Place::Route(name) => {
                let key = name.clone();
                self.route(name, move |host| {
                    // What the commands ask for ends with the mount; their layer is there before its first view.
                    let alive = Rc::new(());
                    let layer = route::layer(host, commands(&Rc::downgrade(&alive)));
                    let mounted = surface::Surface::new(
                        host,
                        owner.clone(),
                        plugin.clone(),
                        &surface,
                        (&key, ""),
                        &SlotInput::default(),
                        alive,
                        viewer.clone(),
                        fail.clone(),
                        calls.clone(),
                        input.clone(),
                        host_time.clone(),
                    );
                    activation.track(Rc::downgrade(&mounted) as Weak<dyn Drawn>);
                    if let Some(holder) = mounted.holder() {
                        holder.hold_route();
                        activation.own(&holder);
                    }
                    Box::new(route::View::fill(host, Box::new(mounted), layer))
                });
            }
            abi::v2::Place::Slot(at) => {
                let path = at.path.clone();
                self.slot(
                    slot::placement(&abi::SlotClaim {
                        kind: at.kind,
                        path: at.path,
                        render: true,
                        mount: false,
                        size: false,
                    }),
                    move |host, slot_input| {
                        let mounted = surface::Surface::new(
                            host,
                            owner.clone(),
                            plugin.clone(),
                            &surface,
                            (&path, &path),
                            slot_input,
                            Rc::new(()),
                            viewer.clone(),
                            fail.clone(),
                            calls.clone(),
                            input.clone(),
                            host_time.clone(),
                        );
                        activation.track(Rc::downgrade(&mounted) as Weak<dyn Drawn>);
                        if let Some(holder) = mounted.holder() {
                            holder.hold_root();
                            activation.own(&holder);
                        }
                        Box::new(mounted)
                    },
                );
            }
            abi::v2::Place::Panel(name) => {
                let key = name.clone();
                let panel: PanelRender = Rc::new(move |host: &dyn Host, parent: &View| {
                    let mounted = surface::Surface::new(
                        host,
                        owner.clone(),
                        plugin.clone(),
                        &surface,
                        (&key, ""),
                        &SlotInput::default(),
                        Rc::new(()),
                        viewer.clone(),
                        fail.clone(),
                        calls.clone(),
                        input.clone(),
                        host_time.clone(),
                    );
                    activation.track(Rc::downgrade(&mounted) as Weak<dyn Drawn>);
                    if let Some(holder) = mounted.holder() {
                        holder.hold_in(parent.clone());
                        activation.own(&holder);
                    }
                    parent.add(&mounted.root());
                    Box::new(mounted) as Box<dyn Claimed>
                });
                self.registration.panels.push((name, panel));
            }
            // An overlay mounts when the plugin opens it ([`abi::Host::overlay`]).
            abi::v2::Place::Overlay(name) => {
                let open: OverlayFn = Rc::new(move |host: &dyn Host, frame: &View| {
                    let mounted = surface::Surface::new(
                        host,
                        owner.clone(),
                        plugin.clone(),
                        &surface,
                        (&surface.name, ""),
                        &SlotInput::default(),
                        Rc::new(()),
                        viewer.clone(),
                        fail.clone(),
                        calls.clone(),
                        input.clone(),
                        host_time.clone(),
                    );
                    activation.track(Rc::downgrade(&mounted) as Weak<dyn Drawn>);
                    if let Some(holder) = mounted.holder() {
                        holder.hold_in(frame.clone());
                        activation.own(&holder);
                    }
                    frame.add(&mounted.root());
                    Some(Box::new(mounted) as Box<dyn Claimed>)
                });
                owners.overlays.borrow_mut().push((name, open));
            }
        }
    }

    /// Registers a renderer claim, on either path: a tool's calls go to the transcript's tool rows, a fence language to
    /// the Markdown code-block renderers. `viewer` runs its view, as `owners`' activation; each part it draws is drawn
    /// again when that activation is woken or a handler of the plugin ran.
    pub(crate) fn renderer_claim(&mut self, entry: abi::claim::Entry, viewer: Rc<dyn claim::Viewer>, owners: &Owners) {
        let target = entry.target.clone();
        // What its parts hold is the plugin's, and the host's work for them its host time, as a surface's (bigboi 1).
        let (monitor, slot) = (self.monitor.clone(), self.monitor.slot(&self.artifact()));
        let host_time: surface::HostTime = Rc::new(move |work| monitor.host(slot, work));
        let registered = claim::Registered::new(
            entry,
            Rc::downgrade(self.host),
            (Rc::from(self.id), host_time),
            viewer,
            owners.input.clone(),
            owners.activation.clone(),
        );
        match target {
            abi::claim::Target::Tool(name) => self.registration.tools.push((name, registered)),
            abi::claim::Target::Fence(language) => {
                self.registration.code_blocks.push((language, claim::fence(registered)));
            }
        }
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
    pub(crate) fn layer(&mut self, layer: opencode_ui::keymap::KeymapLayer<opencode_ui::dialog::FocusId>) {
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
    /// The first activation of the chain it goes on from: a reload of a JS plugin's registrations hands it their
    /// activation of the JS host, so the dialogs they showed are its own ([`Registry::owns`], FT-4). The chain's
    /// activations are the plugin's from that one to this, as one plugin has one activation at a time: one number,
    /// where a list of each grew with the reloads (big-boi's catalog review).
    continues: Option<u64>,
    /// A call of the activation that panicked, if one did.
    failure: Option<ErrorFn>,
    claims: Vec<(Placement, ClaimRender)>,
    routes: Vec<(String, RouteRender)>,
    /// The panel surfaces (P2), each mounting into the panel the host shows.
    panels: Vec<(String, PanelRender)>,
    /// The searches a select names (P2).
    searches: Vec<(String, SearchCall)>,
    code_blocks: Vec<(String, CodeBlockRender)>,
    /// The tool claims, by the tool they claim.
    tools: Vec<(String, Rc<claim::Registered>)>,
    disposers: Vec<Disposer>,
    cleanups: Vec<Box<dyn FnOnce()>>,
    /// Runs the plugin's handlers of a change of the plugins the host lists (P6b).
    plugins: Option<Rc<dyn Fn()>>,
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
    /// Found in a project's `plugins` directory and not approved (rich-plugins 3.9): not loaded, and it claims nothing.
    Pending,
    /// Found in a project's `plugins` directory, and the user declined this build: not loaded, and not asked again.
    Declined,
}

/// One plugin as the plugin manager lists it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    /// What names this entry and no other ([`Registry::toggle_entry`]): `plugin:<id>` for a plugin of the registry,
    /// `held:<target>` for a build held back, `target:<target>` for a target that did not load. An ID alone is not
    /// enough: a held build may share its ID with a loaded plugin (review bigboi-3).
    pub key: String,
    /// The plugin ID, or the configured target of a skipped entry, or its package's name ([`Registry::set_label`]).
    pub id: String,
    /// Where an external or skipped plugin comes from: its `plugins` target or path.
    pub target: Option<String>,
    pub source: Source,
    pub status: Status,
    /// Whether the plugin has an activation, failed or not (TS `registered().active`): the plugin manager offers
    /// to disable it.
    pub active: bool,
    /// What its calls cost, while it is slow (synthesis 4.4).
    pub slow: Option<String>,
}

impl Entry {
    /// The key of the registry's plugin `id`.
    pub fn plugin_key(id: &str) -> String {
        format!("plugin:{id}")
    }

    /// The key of the build held back at `target`.
    pub fn held_key(target: &str) -> String {
        format!("held:{target}")
    }
}

/// Why a configured TypeScript TUI plugin is listed but not loaded (deviation of F16 until P.4).
pub const SKIPPED: &str = "TypeScript TUI plugins do not run in opencode-native yet";
/// Why a TypeScript plugin directory the JS host found no TUI module in is not loaded, before what its resolution
/// said.
pub const NO_TUI_MODULE: &str = "it has no TUI module";
/// Why a TypeScript plugin (a directory, a package named by npm or a server plugin's TUI part) is not loaded while the
/// JS host is off (FT-10, js-npm).
pub const SKIPPED_JS_OFF: &str = "TypeScript TUI plugins run on the JS host, which OPENCODE_PLUGIN_JS turns off: unset it to turn the JS host back on";
/// Why a TypeScript plugin is not loaded when no Bun runs the JS host: neither the local server's opencode binary nor
/// `bun` on the path (O-166).
pub const SKIPPED_NO_BUN: &str = "TypeScript TUI plugins run on the JS host, which needs Bun: neither the server's opencode nor bun on the path runs it; install Bun or set OPENCODE_BUN";

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

/// An external plugin's build that crashed or hung the client (synthesis 4.5). Its library is not opened again, by
/// this client or the next, until the user enables it or another build takes its target.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Crashed {
    /// The ID its build described, for the manager.
    pub id: String,
    pub target: String,
    /// The build ([`Definition::digest`]).
    pub digest: String,
    /// What the manager lists: "crashed the client in `render-slot` and is disabled".
    pub reason: String,
}

/// Why the loader may not open a target's library.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Hold {
    /// Its build crashed the client.
    Crashed { id: String, reason: String },
    /// The client started with every external plugin off.
    Safe,
    /// No parent guards this client, so no native plugin may run in it (decision 5): the reason.
    Unsupervised(String),
}

type Forget = Box<dyn Fn(&Crashed) -> Result<(), String>>;

/// The host's plugins in enable order, and the configured entries it did not load.
pub struct Registry {
    plugins: RefCell<Vec<Plugin>>,
    /// Targets that are not loaded, with their status ([`Status::Skipped`], [`Status::Failed`], [`Status::Pending`] or
    /// [`Status::Declined`]).
    unloaded: RefCell<Vec<(String, Status)>>,
    /// The `plugins` targets, in order, which also enable and disable external plugins as they load.
    directives: RefCell<Vec<String>>,
    activations: Cell<u64>,
    /// The last activation's generation ([`Registry::live`]).
    generations: Cell<u64>,
    /// The slot paths mounted now, which claims resolve against.
    live: Rc<slot::Live>,
    monitor: Rc<contain::Monitor>,
    crashed: RefCell<Vec<Crashed>>,
    forget: RefCell<Option<Forget>>,
    /// Every external plugin is held: a second crash that named no plugin (synthesis 4.5).
    safe: Cell<bool>,
    /// Why every external plugin is held, when no parent guards the client.
    unsupervised: RefCell<Option<String>>,
    /// The targets the user enabled while they were held, this run.
    released: RefCell<Vec<String>>,
    /// The targets held now, never opened: by target, with the ID their crash named, and why.
    held: RefCell<Vec<(String, Hold)>>,
    /// What names a target that is not loaded in place of its path: its package's name (FT-15).
    labels: RefCell<HashMap<String, String>>,
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
            monitor: Rc::new(contain::Monitor::new(contain::Limits::from_env())),
            crashed: RefCell::default(),
            forget: RefCell::default(),
            safe: Cell::new(false),
            unsupervised: RefCell::default(),
            released: RefCell::default(),
            held: RefCell::default(),
            labels: RefCell::default(),
        }
    }

    /// Times every plugin call and keeps the budget (synthesis 4.4).
    pub fn monitor(&self) -> &Rc<contain::Monitor> {
        &self.monitor
    }

    /// The builds that crashed the client, before any loads. `forget` is told when an entry ends: the user enabled the
    /// plugin, or another build took its target. It says whether the crash list kept the change: a release it could not
    /// record does not happen, as the next start would hold the build again.
    pub fn set_crashed(&self, crashed: Vec<Crashed>, forget: impl Fn(&Crashed) -> Result<(), String> + 'static) {
        *self.crashed.borrow_mut() = crashed;
        *self.forget.borrow_mut() = Some(Box::new(forget));
    }

    /// The builds that crashed the client, as known.
    pub fn crashed(&self) -> Vec<Crashed> {
        self.crashed.borrow().clone()
    }

    /// Holds every external plugin from now on, as after a second crash that named no plugin: the user enables them
    /// one at a time. Nothing of it is kept.
    pub fn set_safe(&self) {
        self.safe.set(true);
    }

    /// Holds every external plugin, because no parent guards this client; `reason` says what to do.
    pub fn set_unsupervised(&self, reason: impl Into<String>) {
        *self.unsupervised.borrow_mut() = Some(reason.into());
    }

    /// Whether the loader may open the library of `target`, whose build is `digest`. A held target is listed, and
    /// nothing of it is opened. A crash entry of another build at the target ends.
    pub fn admit(&self, target: &str, digest: &str) -> bool {
        let ended = {
            let mut crashed = self.crashed.borrow_mut();
            let index = crashed.iter().position(|entry| entry.target == target && entry.digest != digest);
            index.map(|index| crashed.remove(index))
        };
        if let (Some(ended), Some(forget)) = (ended, &*self.forget.borrow())
            && let Err(error) = forget(&ended)
        {
            log::warn!("plugin {target}: the crash list kept its old build: {error}");
        }
        let released = self.released.borrow().iter().any(|known| known == target);
        let crash = self.crashed.borrow().iter().find(|entry| entry.target == target).cloned();
        let hold = match crash {
            Some(crash) if !released => Some(Hold::Crashed { id: crash.id, reason: crash.reason }),
            _ if released => None,
            _ if self.safe.get() => Some(Hold::Safe),
            _ => self.unsupervised.borrow().clone().map(Hold::Unsupervised),
        };
        let mut held = self.held.borrow_mut();
        held.retain(|(known, _)| known != target);
        match hold {
            Some(hold) => {
                held.push((target.to_owned(), hold));
                drop(held);
                // Listed once, as held: not also as waiting for approval or declined.
                self.set_unloaded(target, None);
                false
            }
            None => true,
        }
    }

    /// [`Registry::admit`] for the TypeScript plugin of `target`, on the JS host: safe mode holds it; a crash of the
    /// client or a client no parent guards does not, as nothing of it runs in this process.
    pub fn admit_script(&self, target: &str) -> bool {
        let released = self.released.borrow().iter().any(|known| known == target);
        let mut held = self.held.borrow_mut();
        held.retain(|(known, _)| known != target);
        if released || !self.safe.get() {
            return true;
        }
        held.push((target.to_owned(), Hold::Safe));
        drop(held);
        self.set_unloaded(target, None);
        false
    }

    /// Whether plugin `id`, loaded from `target`, starts enabled: as the plugin loaded from it before is, else as the
    /// directives say.
    pub fn starts_enabled(&self, target: &str, id: &str) -> bool {
        self.with_target(target, |plugin| plugin.enabled).unwrap_or_else(|| self.enabled(target, id))
    }

    /// Whether `target` is held.
    pub fn held(&self, target: &str) -> bool {
        self.held.borrow().iter().any(|(known, _)| known == target)
    }

    /// Lets the user's enable of a held target through: it ends its crash entry, and the loader opens it next.
    fn release(&self, host: &Rc<dyn Host>, id: &str) -> Option<Result<(), String>> {
        let target = {
            let held = self.held.borrow();
            let (target, _) = held.iter().find(|(target, hold)| match hold {
                Hold::Crashed { id: known, .. } => known == id || target == id,
                _ => target == id,
            })?;
            target.clone()
        };
        self.release_target(host, &target)
    }

    /// [`Registry::release`] of the build held at `target`. The crash list must keep its end first (review bigboi,
    /// inherited): else the build stays held, and the user is told why.
    fn release_target(&self, host: &Rc<dyn Host>, target: &str) -> Option<Result<(), String>> {
        let hold = self.held.borrow().iter().find(|(known, _)| known == target).map(|(_, hold)| hold.clone())?;
        if let Hold::Unsupervised(reason) = hold {
            return Some(Err(reason));
        }
        let ended: Vec<Crashed> =
            self.crashed.borrow().iter().filter(|entry| entry.target == target).cloned().collect();
        if let Some(forget) = &*self.forget.borrow()
            && let Err(error) = ended.iter().try_for_each(forget)
        {
            return Some(Err(format!("The plugin stays disabled: its crash could not be forgotten: {error}")));
        }
        self.crashed.borrow_mut().retain(|entry| entry.target != target);
        self.held.borrow_mut().retain(|(known, _)| known != target);
        self.released.borrow_mut().push(target.to_owned());
        host.plugins_changed();
        Some(Ok(()))
    }

    /// The plugin manager's toggle of the entry `key` names ([`Entry::key`]), `None` when there is none or it cannot be
    /// toggled: a plugin of the registry as [`Registry::toggle`], or the release of a held build, which only enables.
    pub fn toggle_entry(&self, host: &Rc<dyn Host>, key: &str, active: bool) -> Option<Result<(), String>> {
        if let Some(id) = key.strip_prefix("plugin:") {
            self.with_plugin(id, |_| ())?;
            return self.toggle(host, id, active);
        }
        let target = key.strip_prefix("held:").filter(|_| active)?;
        self.release_target(host, target)
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

    /// Names `target` `label` in the list while it is not loaded, as its package's name rather than its path.
    pub fn set_label(&self, target: &str, label: String) {
        self.labels.borrow_mut().insert(target.to_owned(), label);
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
        self.held.borrow_mut().retain(|(known, _)| known != target);
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
        // A held target is not loaded: enabling it lets the loader open it; there is nothing to disable.
        if self.with_plugin(id, |_| ()).is_none() {
            return if active { self.release(host, id) } else { None };
        }
        // A plugin that failed while active is listed failed by its activation's failure, which the restart ends: kept
        // as its listed failure, so a setup that fails again leaves the row failed (review carbon-3).
        let before = self.with_plugin(id, |plugin| {
            let failed = plugin.failed.clone().or_else(|| plugin.active.as_ref().and(plugin.definition.failure()));
            (plugin.enabled, failed)
        })?;
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

    /// Runs the `on_plugins` handlers of every active plugin (P6b): what [`Registry::entries`] lists changed. A failed
    /// plugin's calls are refused. Called outside every plugin callback.
    pub fn tell_plugins(&self) {
        let heard: Vec<Rc<dyn Fn()>> = self
            .plugins
            .borrow()
            .iter()
            .filter_map(|plugin| plugin.active.as_ref().and_then(|(_, registration)| registration.plugins.clone()))
            .collect();
        heard.iter().for_each(|run| run());
    }

    /// Every plugin and skipped entry, for the plugin manager.
    pub fn entries(&self) -> Vec<Entry> {
        let plugins = self.plugins.borrow();
        let active = plugins.iter().map(|plugin| {
            let status = match &plugin.active {
                Some(_) => plugin.definition.failure().map_or(Status::Active, Status::Failed),
                None => plugin.failed.clone().map_or(Status::Inactive, Status::Failed),
            };
            Entry {
                key: Entry::plugin_key(&plugin.definition.id),
                id: plugin.definition.id.clone(),
                target: plugin.definition.target().map(str::to_owned),
                source: plugin.source,
                // `slow` is a flag on `active` (4.14).
                slow: (status == Status::Active).then(|| self.monitor.report(&plugin.definition.id)).flatten(),
                status,
                active: plugin.active.is_some(),
            }
        });
        let held = self.held.borrow();
        let held = held.iter().map(|(target, hold)| {
            let (id, source, status) = match hold {
                Hold::Crashed { id, reason } => (id.clone(), Source::External, Status::Failed(reason.clone())),
                Hold::Safe => (target.clone(), Source::External, Status::Inactive),
                Hold::Unsupervised(reason) => (target.clone(), Source::Configured, Status::Skipped(reason.clone())),
            };
            let key = Entry::held_key(target);
            Entry { key, id, target: Some(target.clone()), source, status, active: false, slow: None }
        });
        let unloaded = self.unloaded.borrow();
        let labels = self.labels.borrow();
        let unloaded = unloaded.iter().map(|(target, status)| Entry {
            key: format!("target:{target}"),
            id: labels.get(target).unwrap_or(target).clone(),
            target: Some(target.clone()),
            source: Source::Configured,
            status: status.clone(),
            active: false,
            slow: None,
        });
        active.chain(held).chain(unloaded).collect()
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

    /// Whether what activation `generation` of plugin `id` showed is the running activation's: it is that one, or one
    /// it goes on from (a reload of a JS plugin's registrations, FT-4), and it has not failed. A dialog of such an
    /// activation stays open and acts.
    pub fn owns(&self, id: &str, generation: u64) -> bool {
        self.with_plugin(id, |plugin| {
            plugin.active.as_ref().is_some_and(|(_, registration)| {
                (registration.generation == generation
                    || registration
                        .continues
                        .is_some_and(|since| (since..registration.generation).contains(&generation)))
                    && !registration.panicked()
            })
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

    /// Whether active plugin `id` registered the route `name`.
    pub fn has_route(&self, id: &str, name: &str) -> bool {
        self.with_plugin(id, |plugin| {
            plugin
                .active
                .as_ref()
                .is_some_and(|(_, registration)| registration.routes.iter().any(|(route, _)| route == name))
        })
        .unwrap_or(false)
    }

    /// Whether active plugin `id` registered the panel surface `name`.
    pub fn has_panel(&self, id: &str, name: &str) -> bool {
        self.with_plugin(id, |plugin| {
            plugin
                .active
                .as_ref()
                .is_some_and(|(_, registration)| registration.panels.iter().any(|(panel, _)| panel == name))
        })
        .unwrap_or(false)
    }

    /// Mounts the panel surface plugin `id` registers as `name` into `parent`, the panel the host shows: what it returns
    /// is the mount, which ends when it drops.
    pub fn panel(&self, host: &dyn Host, id: &str, name: &str, parent: &View) -> Option<PanelMount> {
        let render = self.with_plugin(id, |plugin| {
            let (_, registration) = plugin.active.as_ref().filter(|_| plugin.running())?;
            registration.panels.iter().find(|(panel, _)| panel == name).map(|(_, render)| render.clone())
        })??;
        Some(PanelMount(render(host, parent)))
    }

    /// The values of `options` that plugin `id`'s search `name` lists for `query`, in its order; `None` when it has no
    /// such search, or the search failed. A select that names it closes with the activation that showed it.
    pub fn search(
        &self,
        host: &dyn Host,
        id: &str,
        name: &str,
        query: &str,
        options: &[abi::SelectOption],
    ) -> Option<Vec<String>> {
        let search = self.with_plugin(id, |plugin| {
            let (_, registration) = plugin.active.as_ref().filter(|_| plugin.running())?;
            registration.searches.iter().find(|(search, _)| search == name).map(|(_, run)| run.clone())
        })??;
        search(host, query, options)
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

    /// The tool claims of the active plugins. The host takes them when it mounts a transcript, and mounts the route
    /// again when a plugin is enabled, disabled, reloaded or fails, as for the code-block renderers.
    pub fn tool_claims(&self) -> claim::ToolClaims {
        claim::ToolClaims::new(self.by_activation(|registration| &registration.tools))
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
        let artifact = definition.target().zip(definition.digest.as_deref());
        let mut setup = Setup { host, id: &definition.id, registration, monitor: &self.monitor, artifact };
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
/// A mounted panel surface of a plugin (P2): it ends when it drops.
pub struct PanelMount(Box<dyn Claimed>);

impl PanelMount {
    /// Takes the host's theme in place, keeping its widgets and their state; false when it must mount again.
    pub fn restyle(&self, host: &dyn Host) -> bool {
        self.0.restyle(host)
    }
}

pub struct RouteMount(Box<dyn Claimed>);

impl RouteMount {
    pub fn root(&self) -> View {
        self.0.root()
    }

    /// Takes the host's theme in place, keeping its widgets and their state; false when it must mount again.
    pub fn restyle(&self, host: &dyn Host) -> bool {
        self.0.restyle(host)
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

    /// Takes the host's theme in place: each claim keeps its widgets, its mount and their state. False when a claim
    /// cannot, so the owner mounts the slot again.
    pub fn restyle(&self, host: &dyn Host) -> bool {
        // Every claim restyles, also after one that cannot: a count, not `all`, which would stop there.
        let mut failed = self.claims.iter().filter(|claim| !claim.restyle(host)).count();
        if let Some(nested) = &self.nested {
            failed += nested.appended.borrow().iter().filter(|(_, claim)| !claim.restyle(host)).count();
        }
        let done = failed == 0;
        if let Some(live) = self.live() {
            settle(host, live);
        }
        done
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
