//! The TUI shell, route lifecycle, and application keymap.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use opencode_api::client::Client;
use opencode_api::events::{self, Connection};
use opencode_local::cli_config::{CliConfig, Info, Resolved, ThemeMode as ConfigMode};
use opencode_local::paths::Paths;
use opencode_local::storage::Storage;
use opencode_store::{Data, Options};
use opencode_ui::dialog::{DialogKeymap, Dialogs, focus_path};
use opencode_ui::keymap::{COMMAND_PALETTE_COMMAND, Keybinds, Slash};
use opencode_ui::theme::{Effect, ModeSetting, TerminalColors, ThemeMode, ThemeState, ThemeStateOptions};
use opencode_ui::toast::Toasts;
use opencode_ui::{help, palette};
use opentui::app::ProxyError;
use opentui::widget::Textarea;

use crate::features::startup::{Args, Startup};
use crate::prelude::*;
use crate::routes::{self, RouteView};

pub struct Deps {
    pub client: Client,
    pub directory: String,
    pub config: Resolved,
    pub roots: Option<Roots>,
    pub route: Route,
    pub continue_: bool,
    pub events: bool,
    /// Renderer plugins in registration order: Mermaid, then LaTeX. The shell receives them from the caller to avoid
    /// depending on the renderers.
    pub builtins: Vec<opencode_plugin::Builtin>,
    /// Run built-ins through the native plugin ABI for carrier comparison tests.
    pub abi_builtins: bool,
}

pub struct Roots {
    pub paths: Paths,
    pub storage_channel: String,
}

pub struct Launch {
    pub deps: Deps,
    pub args: Args,
    /// Kept alive while the TUI runs: dropping a standalone connection stops its server.
    pub keep: Box<dyn std::any::Any>,
    pub plugins: Option<crate::plugins::host::External>,
}

/// The shared context. Held as `Rc<Tui>`; widget callbacks keep a [`Weak`].
pub struct Tui {
    pub app: App,
    pub router: opencode_plugin::interact::Router,
    pub plugin_overlays: View,
    pub data: Data,
    pub keymap: Rc<DialogKeymap>,
    pub dialogs: Dialogs,
    pub toasts: Toasts,
    pub theme: RefCell<ThemeState>,
    pub directory: String,
    /// The prompt textarea with edit bindings. `textarea_enabled` also requires focus.
    pub textarea: Rc<RefCell<Option<Textarea>>>,
    pub prompt: crate::prompt::editor::Shared,
    pub settings: crate::dialogs::settings::Live,
    pub local: Rc<crate::local::Local>,
    pub startup: Startup,
    pub plugins: crate::plugins::host::Plugins,
    pub(crate) reads: crate::plugins::host::Reads,
    pub epilogue: crate::features::epilogue::Epilogue,
    pub updates: crate::features::update_notification::Updates,
    pub(crate) location: crate::features::location::LocationState,
    pub(crate) overlays: crate::features::overlays::Overlays,
    pub(crate) title: crate::features::title::Title,
    /// The one pending release of the terminal to another program.
    pub(crate) foreground: crate::features::foreground::Foreground,
    /// The custom-theme scans asked for so far; only the last one's result applies ([`discover_themes`]).
    theme_scans: Cell<u64>,
    /// The selected theme's name as the plugins last heard of it.
    theme_selected: RefCell<String>,
    pub(crate) session_links: crate::features::session_links::Registry,
    pub(crate) events: crate::features::events::Events,
    pub attention: crate::features::attention::notify::Attention,
    pub tabs: crate::tabs::Tabs,
    pub frame: crate::frame::Frame,
    pub panels: crate::panel::Panels,
    pub terminals: crate::terminal::Terminals,
    pub client_mcp: crate::client_mcp::ClientMcp,
    pub composer: crate::composer::Memory,
    /// Inbox items with a pending action in flight ([`crate::routes::session::queued::mutate`]).
    pub(crate) pending_actions: RefCell<std::collections::HashSet<String>>,
    files: Option<Files>,
    route: RefCell<Route>,
    /// The routes shown before the plugin routes on screen, the latest last: where the reserved chord goes back to.
    before_plugin: RefCell<Vec<Route>>,
    view: RefCell<Option<Box<dyn RouteView>>>,
    /// Page theme of the current route.
    painted: Live,
    /// Defer the theme remount until the pending key sequence ends.
    restyle: Cell<bool>,
    seen: Cell<u64>,
    /// [`Tui::hold_sync`].
    held: Cell<bool>,
    followers: RefCell<Vec<Follower>>,
    connection: RefCell<Option<Connection>>,
    pub(crate) layers: RefCell<Vec<Disposer>>,
    this: Weak<Tui>,
}

/// A [`Tui::follow`] registration; false once its target is gone.
type Follower = Rc<dyn Fn(&Tui, &Changes) -> bool>;

#[derive(Clone)]
struct Files {
    config: CliConfig,
    storage: Option<Storage>,
    state: std::path::PathBuf,
    cache: std::path::PathBuf,
}

/// Posted when the store flushed; at most one is queued.
#[derive(Clone)]
struct DataChanged;

#[derive(Clone)]
struct StatusChanged(events::State);

impl Tui {
    pub fn route(&self) -> Route {
        self.route.borrow().clone()
    }

    pub fn weak(&self) -> Weak<Tui> {
        self.this.clone()
    }

    /// Runs `request` on tokio. `done` gets its value on the UI thread; an error shows as an error toast.
    /// Neither runs once the TUI is gone.
    pub fn request<T: Send + 'static, E: std::fmt::Display + Send + 'static>(
        &self,
        request: impl Future<Output = Result<T, E>> + Send + 'static,
        done: impl FnOnce(&Tui, T) + 'static,
    ) {
        self.app.spawn(
            request,
            bind!(self, |tui, _, result| match result {
                Ok(value) => done(&tui, value),
                Err(error) => tui.toasts.error(error.to_string()),
            }),
        );
    }

    /// Borrow the current resolved config briefly: a settings change replaces it.
    pub fn config(&self) -> std::cell::Ref<'_, Resolved> {
        self.settings.config()
    }

    pub fn storage(&self) -> Option<Storage> {
        self.files.as_ref().and_then(|files| files.storage.clone())
    }

    pub fn state_dir(&self) -> Option<std::path::PathBuf> {
        self.files.as_ref().map(|files| files.state.clone())
    }

    pub fn cache_dir(&self) -> Option<std::path::PathBuf> {
        self.files.as_ref().map(|files| files.cache.clone())
    }

    /// The event connection's state while it is open.
    pub fn connection_watch(&self) -> Option<tokio::sync::watch::Receiver<events::State>> {
        self.connection.borrow().as_ref().map(Connection::watch)
    }

    /// The page theme the views paint in, shared: it changes in place on a theme switch, before the views restyle.
    pub fn live_theme(&self) -> Live {
        self.painted.clone()
    }

    pub fn page(&self) -> Theme {
        self.theme.borrow().theme().page()
    }

    /// Shows a session the user picked (a tab, the session list, a link). TS's `route.navigate` reconciles the route
    /// store, so the session on screen keeps its view, its scroll and its prompt; [`Tui::navigate`] to the route shown
    /// mounts it again, which only a theme or plugin change wants.
    pub fn show_session(&self, id: SessionID) {
        let route = Route::Session { id };
        if self.view.borrow().is_some() && self.route() == route {
            return;
        }
        self.navigate(route);
    }

    pub fn navigate(&self, route: Route) {
        // Going home from home to another location is a navigation, not a remount.
        let remount =
            self.view.borrow().is_some() && self.route() == route && !crate::features::location::pending(self);
        // Mounting may move the focus (a docked panel, a pending permission); an open dialog keeps it.
        let dialog = self.dialogs.is_open().then(|| self.app.focused());
        let complete = remount
            .then(|| self.prompt.current.borrow().upgrade().and_then(|prompt| prompt.autocomplete.get()?.take_open()))
            .flatten();
        // Mount the new plugin view before dropping its predecessor so mount counts never reach zero. Host routes drop
        // the old view first to hand over the draft.
        let old = self.view.borrow_mut().take();
        if let Some(view) = &old {
            view.root().detach();
        }
        let old = if remount && matches!(route, Route::Plugin { .. }) {
            old
        } else {
            drop(old);
            None
        };
        let before = self.route.replace(route.clone());
        match &route {
            Route::Plugin { .. } if before != route => self.before_plugin.borrow_mut().push(before),
            Route::Plugin { .. } => {}
            _ => self.before_plugin.borrow_mut().clear(),
        }
        if route == Route::Home && !remount {
            crate::features::location::home(self);
        }
        // The tab strip shows before the view lays out, so a transcript sticks to the bottom it ends with.
        crate::tabs::route_changed(self);
        crate::frame::refresh(self);
        let view = routes::mount(self, &route);
        drop(old);
        self.frame.main().add(&view.root());
        view.sync(self, &opencode_store::Changes::everything());
        crate::frame::mount_app(self, remount);
        // A remount under an open dialog (a theme change, a plugin toggled in `/plugins`) must not take the dialog's
        // focus; the new view takes it once the dialog closes, as the old one would have.
        let target = view.focus_target();
        match dialog {
            None => {
                if let Some(widget) = &target {
                    widget.focus();
                }
            }
            Some(dialog) => {
                if let Some(widget) = &target {
                    self.dialogs.refocus(widget);
                }
                match dialog {
                    Some(widget) => widget.focus(),
                    None => self.app.blur(),
                }
            }
        }
        *self.view.borrow_mut() = Some(view);
        // Restore list mode only when the new composer owns focus, including after a dialog closes.
        if let Some(open) = complete {
            let prompt = self.prompt.current.borrow().upgrade();
            let focused = |prompt: &Rc<crate::prompt::editor::Inner>| target == Some(prompt.textarea.as_any());
            match prompt.as_ref().filter(|prompt| focused(prompt)).and_then(|prompt| prompt.autocomplete.get()) {
                Some(complete) => complete.reopen(open),
                None => {
                    let weak = self.weak();
                    self.app.defer(move |_| {
                        drop(open);
                        if let Some(tui) = weak.upgrade() {
                            tui.keymap.sync_mode();
                        }
                    });
                }
            }
        }
        crate::features::title::route_changed(self);
        crate::features::devtools::route_changed(self);
        crate::features::attention::program_status::sync(self);
        // The new route's session and its prompt's text, restored or not, are what a restart brings back.
        crate::plugins::contain::sync(self);
        self.app.request_redraw();
    }

    /// Holds the store's changes back from the views, or releases them, for a test that measures what one change does
    /// on its own while reads land: they show once released.
    #[doc(hidden)]
    pub fn hold_sync(&self, held: bool) {
        if self.held.replace(held) && !held {
            self.sync();
        }
    }

    /// Whether the views have taken every flush of the store: a test that applies events waits for it.
    #[doc(hidden)]
    pub fn synced(&self) -> bool {
        self.seen.get() == self.data.revision()
    }

    /// Pass changes accumulated between syncs to the route view.
    fn sync(&self) {
        if self.held.get() {
            return;
        }
        let (revision, changes) = self.data.changes_since(self.seen.get());
        self.seen.set(revision);
        crate::features::events::deltas(self);
        if changes.is_empty() {
            return;
        }
        if let Some(view) = self.view.borrow().as_ref() {
            view.sync(self, &changes);
        }
        let followers = self.followers.borrow().clone();
        for follower in followers {
            // One closed by an earlier one is skipped; one whose target is gone is dropped.
            let open = self.followers.borrow().iter().any(|open| Rc::ptr_eq(open, &follower));
            if open && !follower(self, &changes) {
                self.followers.borrow_mut().retain(|open| !Rc::ptr_eq(open, &follower));
            }
        }
        // After the view, whose new text records the labels it draws.
        crate::features::session_links::sync(self, &changes);
        crate::frame::sync_app(self, &changes);
        crate::features::title::sync(self, &changes);
        crate::features::events::sync(self, &changes);
        crate::plugins::host::sync(self);
        self.local.sync(&changes);
        crate::tabs::sync(self, &changes);
        crate::frame::refresh(self);
        crate::frame::observe_markers(self);
        crate::features::attention::program_status::sync(self);
    }

    /// Sync `target` after the route view on each store flush, until the disposer runs or the target drops.
    pub(crate) fn follow<T: 'static>(&self, target: &Rc<T>, sync: impl Fn(&T, &Tui, &Changes) + 'static) -> Disposer {
        let target = Rc::downgrade(target);
        let follower: Follower =
            Rc::new(move |tui, changes| target.upgrade().map(|target| sync(&target, tui, changes)).is_some());
        self.followers.borrow_mut().push(follower.clone());
        let (tui, follower) = (self.weak(), Rc::downgrade(&follower));
        Disposer::new(move || {
            if let (Some(tui), Some(follower)) = (tui.upgrade(), follower.upgrade()) {
                tui.followers.borrow_mut().retain(|open| !Rc::ptr_eq(open, &follower));
            }
        })
    }

    /// Syncs the route view with everything, after state outside the store changed.
    pub(crate) fn resync(&self) {
        if let Some(view) = self.view.borrow().as_ref() {
            view.sync(self, &opencode_store::Changes::everything());
        }
        crate::frame::sync_app(self, &opencode_store::Changes::everything());
        self.app.request_redraw();
    }

    /// Refresh the route for a view change outside the store.
    pub(crate) fn sync_view(&self) {
        if let Some(view) = self.view.borrow().as_ref() {
            view.sync(self, &opencode_store::Changes::default());
        }
        crate::frame::sync_app(self, &opencode_store::Changes::default());
        self.app.request_redraw();
    }

    pub fn theme_changed(&self) {
        let (effects, error) = {
            let mut theme = self.theme.borrow_mut();
            (theme.take_effects(), theme.take_error())
        };
        if let Some(error) = error {
            self.toasts.theme_error(error);
        }
        if effects.contains(&Effect::ProbePalette) {
            self.app.refresh_palette();
        }
        if let Some(files) = self.files.clone() {
            let effects: Vec<Effect> =
                effects.into_iter().filter(|effect| !matches!(effect, Effect::ProbePalette)).collect();
            if !effects.is_empty() {
                self.app.runtime().spawn_blocking(move || persist(&files, effects));
            }
        }
        // The plugins read the selected theme's name, which can change with the palette the same (`opencode` and
        // `system` without a terminal palette), so it is not a repaint that tells them.
        let selected = self.theme.borrow().selected().to_owned();
        if *self.theme_selected.borrow() != selected {
            *self.theme_selected.borrow_mut() = selected;
            crate::plugins::host::local_changed(self);
        }
        let theme = self.page();
        if self.painted.get() == theme {
            return;
        }
        self.painted.set(theme.clone());
        self.app.set_theme(app_theme(&theme));
        self.dialogs.set_theme(theme.clone());
        self.toasts.set_theme(theme);
        // Remounting the diff viewer resets focus; defer it until the pending key sequence ends.
        if matches!(self.route(), Route::Plugin { .. }) && self.keymap.keymap().has_pending_sequence() {
            self.restyle.set(true);
            return;
        }
        self.restyle_route();
    }

    fn restyle_route(&self) {
        self.restyle.set(false);
        // Before the first route mounts there is nothing to repaint.
        if self.view.borrow().is_none() {
            return;
        }
        self.router.restyle(self);
        if self.view.borrow().as_ref().is_some_and(|view| view.restyle(self)) {
            // The `app` slot's plugin claims take the theme in place, or mount again when one cannot.
            crate::frame::restyle_app(self);
            self.app.request_redraw();
            return;
        }
        let prompt = self.textarea.borrow().as_ref().is_some_and(|textarea| is_focused(&self.app, textarea));
        self.navigate(self.route());
        let textarea = self.textarea.borrow().clone();
        if let Some(textarea) = textarea.filter(|_| prompt && !self.dialogs.is_open()) {
            self.app.focus(&textarea);
        }
    }
}

impl Drop for Tui {
    /// An open dialog holds the dialog stack, which holds the keymap and with it every plugin's commands, so the TUI
    /// frees them as it ends.
    fn drop(&mut self) {
        self.dialogs.release();
    }
}

impl opencode_ui::bind::WeakRef for Tui {
    type Target = Tui;
    fn weak_ref(&self) -> Weak<Tui> {
        self.weak()
    }
}

/// Builds the TUI on `app`. The returned handle owns it; drop it after the app stops.
pub fn mount(app: &App, deps: Deps) -> Rc<Tui> {
    mount_with(app, deps, Args::default())
}

pub fn mount_with(app: &App, deps: Deps, args: Args) -> Rc<Tui> {
    let runtime = app.runtime();
    let _guard = runtime.enter();
    let data = Data::with_runtime(
        deps.client.clone(),
        Options {
            directory: deps.directory.clone(),
            omit_tool_file_data: !crate::features::system_commands::image_preview(&deps.config.info),
            ..Options::default()
        },
        runtime.clone(),
    );
    let files = deps.roots.as_ref().map(|roots| Files {
        config: CliConfig::new(&roots.paths),
        storage: Storage::new(&roots.paths.state, &roots.storage_channel)
            .inspect_err(|error| log::warn!("TUI storage is unavailable: {error}"))
            .ok(),
        state: roots.paths.state.clone(),
        cache: roots.paths.cache.clone(),
    });
    let theme = ThemeState::new(theme_options(app, &deps.config.info, files.as_ref()));

    let textarea: Rc<RefCell<Option<Textarea>>> = Rc::default();
    let keybinds = Keybinds::resolve(&deps.config.keybinds(), !cfg!(windows)).unwrap_or_else(|error| {
        log::warn!("invalid keybinds config: {error}");
        Keybinds::defaults()
    });
    let keymap = Rc::new(DialogKeymap::new(
        keybinds,
        opencode_ui::keymap::Options {
            leader_timeout: deps.config.leader_timeout,
            textarea_enabled: textarea_focused(app, &textarea),
            textarea_run: {
                let textarea = textarea.clone();
                Rc::new(move |action| {
                    let current = textarea.borrow().clone();
                    current.is_some_and(|textarea| {
                        textarea.perform(action);
                        true
                    })
                })
            },
        },
    ));

    opencode_ui::motion::set_running(app, opencode_ui::motion::enabled(deps.config.info.animations));
    let page = theme.theme().page();
    app.set_theme(app_theme(&page));
    let shell = View::new(app).column().grow(1.0).basis(Length::Auto);
    app.root().add(&shell);
    let toasts = Toasts::new(app, page.clone(), &shell);
    let dialogs = Dialogs::new(app, keymap.clone(), page.clone());
    let plugin_overlays = View::new(app)
        .absolute()
        .z_index(2500)
        .width(Length::percent(100.0))
        .height(Length::percent(100.0))
        .visible(false);
    // Before the plugin behaviors' hook, which stays the root's last child.
    opencode_ui::root::add(app, &plugin_overlays);
    let local_files = deps.roots.as_ref().map(|roots| crate::local::Files {
        state: roots.paths.state.clone(),
        storage: files.as_ref().and_then(|files| files.storage.clone()),
    });

    let plugins = crate::plugins::host::registry(&deps.config.info, deps.builtins, deps.abi_builtins);
    let settings =
        crate::dialogs::settings::Live::new(deps.config, args.auto, files.as_ref().map(|files| files.config.clone()));
    let tui = Rc::new_cyclic(|this: &Weak<Tui>| Tui {
        local: crate::local::Local::new(app, data.clone(), dialogs.clone(), toasts.clone(), local_files, this.clone()),
        app: app.clone(),
        router: Default::default(),
        plugin_overlays,
        data,
        keymap,
        dialogs,
        toasts,
        theme: RefCell::new(theme),
        directory: deps.directory,
        textarea,
        prompt: crate::prompt::editor::Shared::new(app, deps.roots.as_ref().map(|roots| roots.paths.state.clone())),
        settings,
        startup: Startup::new(args),
        plugins,
        reads: Default::default(),
        epilogue: Default::default(),
        updates: Default::default(),
        location: Default::default(),
        overlays: Default::default(),
        title: Default::default(),
        foreground: Default::default(),
        theme_scans: Cell::new(0),
        theme_selected: RefCell::default(),
        session_links: Default::default(),
        events: Default::default(),
        attention: Default::default(),
        tabs: Default::default(),
        frame: crate::frame::Frame::new(app, this.clone()),
        panels: Default::default(),
        terminals: Default::default(),
        client_mcp: Default::default(),
        composer: Default::default(),
        pending_actions: RefCell::default(),
        files,
        route: RefCell::new(Route::Home),
        before_plugin: RefCell::default(),
        view: RefCell::new(None),
        painted: Live::new(page),
        restyle: Cell::new(false),
        seen: Cell::new(0),
        held: Cell::new(false),
        followers: RefCell::default(),
        connection: RefCell::new(None),
        layers: RefCell::new(Vec::new()),
        this: this.clone(),
    });

    install_keys(&tui);
    install_theme(&tui);
    crate::plugins::host::count_local(&tui);
    // Subscribe before connecting: broadcasts do not replay the initial `server.connected` event.
    crate::features::events::install(&tui);
    let wakeups = install_wakeups(&tui, deps.events);
    crate::tabs::install(&tui);
    crate::terminal::install(&tui);
    crate::client_mcp::install(&tui);
    crate::frame::install(&tui, &shell);
    crate::features::clear::install(&tui);
    crate::features::quick_switch::install(&tui);
    crate::features::overlays::install(&tui);
    crate::features::title::install(&tui);
    crate::features::attention::notify::install(&tui);
    let system = crate::features::system_commands::install(&tui);
    tui.layers.borrow_mut().extend(system);
    crate::features::links::install(&tui);
    crate::dialogs::settings::install(&tui);
    crate::dialogs::mcp::install(&tui);
    crate::dialogs::working_directory::install(&tui);
    crate::dialogs::theme_list::install(&tui);
    crate::dialogs::status::install(&tui);
    crate::dialogs::pair::install(&tui);
    crate::dialogs::model::install(&tui);
    crate::dialogs::integration::install(&tui);
    // Mount the route before registering built-ins to preserve palette order.
    let held = tui.keymap.hold(|| crate::plugins::host::install(&tui));
    tui.startup.aim(&deps.route, deps.continue_);
    tui.navigate(deps.route);
    drop(held);
    // Start route reads before the event stream to avoid reading active sessions twice.
    let status = deps.events.then(|| connect(&tui));
    pump(&tui.app, wakeups, status);
    crate::features::highlights::install(&tui, deps.continue_);
    crate::features::devtools::mount(&tui, &shell);
    crate::features::startup::run(&tui, deps.continue_);
    tui
}

/// The app options of the TUI, before the terminal's mouse setting.
pub fn options() -> AppOptions {
    AppOptions {
        exit_on_ctrl_c: false,
        // Let the configurable `terminal.suspend` binding own Ctrl+Z.
        suspend_on_ctrl_z: false,
        palette_size: 16,
        // `--print-logs` records and stray stderr writes would draw over the screen; they go to the console and
        // reach the real stderr once the terminal is restored.
        capture_stderr: true,
        // A click moves focus only when its handler requests it.
        focus_on_click: false,
        ..AppOptions::default()
    }
}

/// Runs the TUI on the terminal until it quits.
pub fn run(launch: Launch) -> opentui::Result<()> {
    let mut options = options();
    options.host.terminal.mouse = crate::features::system_commands::mouse_tracking(&launch.deps.config);
    if let Some(manifest) = crate::features::drive::manifest() {
        return crate::features::drive::run(manifest?, options, launch);
    }
    let app = App::new(options)?;
    // Around the hook `App::new` installed, which restores the terminal: a plugin's panic its catch stops is not the
    // end of the app.
    opencode_plugin::contain::filter_panics();
    // Only the TUI on the real terminal plays sounds out loud; tests and harnesses mix them without a device.
    run_on(app, launch, |tui| {
        tui.attention.sound.set_output(crate::features::attention::sound::Output::Device);
        Ok(())
    })
}

/// Runs the TUI on `app` until it quits; `started` runs once the TUI is mounted.
pub fn run_on(app: App, launch: Launch, started: impl FnOnce(&Rc<Tui>) -> opentui::Result<()>) -> opentui::Result<()> {
    let tui = mount_with(&app, launch.deps, launch.args);
    if let Some(external) = launch.plugins {
        crate::plugins::host::external(&tui, external);
    }
    started(&tui)?;
    crate::prompt::editor_context::start(&tui, crate::prompt::editor_context::Source::from_env());
    let result = app.run();
    // Print as soon as the terminal returns: a second Ctrl+C can interrupt teardown.
    if let Some(text) = crate::features::epilogue::text(&tui).filter(|_| result.is_ok()) {
        crate::features::epilogue::print(&text);
    }
    // Dispose active plugins while their TUI still exists.
    tui.plugins.deactivate_all();
    // Their storage writes reach the disk before the process can exit; UI effects and replies are not waited for.
    crate::plugins::host::flush_storage(&tui);
    drop(tui);
    drop(launch.keep);
    result
}

/// Route keys before widgets. Apply plugin edits, mode changes, and focus changes before the next key in the batch.
fn route_keys(tui: &Rc<Tui>) {
    let weak = tui.weak();
    tui.app.on_key_capture(move |cx, key| {
        let Some(tui) = weak.upgrade() else { return };
        tui.router.prune();
        tui.keymap.keymap().set_focus(focus_path(cx.app()));
        let result = tui.keymap.handle_key(key);
        if result.prevent_default {
            cx.prevent_default();
        }
        if result.handled || result.stop_propagation {
            cx.stop_propagation();
        }
        opencode_plugin::flush();
    });
}

fn close_plugin_surface(tui: &Tui) -> bool {
    if tui.router.close_focused(tui) {
        return true;
    }
    let panel = tui.panels.current().filter(|target| {
        crate::frame::panel_state(tui, target).is_some_and(|(_, focused)| focused)
            || crate::frame::fullscreen_panel(tui)
    });
    if panel.is_some() {
        tui.panels.close(tui);
        return true;
    }
    // The reserved chord returns focus from a plugin field to the composer without clearing its draft or exiting.
    if tui.router.surface_focused(tui) && !matches!(tui.route(), Route::Plugin { .. }) {
        opencode_plugin::Host::focus_composer(tui);
        if opencode_plugin::Host::composer_focused(tui) {
            // The plugins' layers stop holding at the composer too, until the focus moves again.
            tui.router.escape(tui);
            return true;
        }
    }
    if !matches!(tui.route(), Route::Plugin { .. }) {
        return false;
    }
    let back = tui.before_plugin.borrow_mut().pop().unwrap_or(Route::Home);
    // Preserve the back stack when returning to a plugin route.
    let rest = std::mem::take(&mut *tui.before_plugin.borrow_mut());
    tui.navigate(back);
    if matches!(tui.route(), Route::Plugin { .. }) {
        *tui.before_plugin.borrow_mut() = rest;
    }
    true
}

fn install_keys(tui: &Rc<Tui>) {
    // Reset plugin input before routing the reserved chord.
    let weak = tui.weak();
    tui.app.on_key_capture(move |cx, key| {
        let Some(tui) = weak.upgrade() else { return };
        if !key.matches(opencode_plugin::abi::interact::RESERVED) {
            return;
        }
        tui.router.escape(&*tui);
        if tui.app.selected_text().is_some() || tui.dialogs.is_open() {
            return;
        }
        if close_plugin_surface(&tui) {
            cx.prevent_default();
            cx.stop_propagation();
        }
    });
    crate::features::console_copy::install(tui);
    crate::features::selection::install(tui);
    crate::terminal::install_keys(tui);
    route_keys(tui);
    tui.layers.borrow_mut().push(opencode_ui::dialog::expire_leader(&tui.app, &tui.keymap));

    tui.keymap.set_first_layer(app_commands());
    // Keep commands globally available to the palette over dialogs; bind their keys in separate layers.
    let weak = tui.weak();
    let command = |id: &str, run: fn(&Tui)| TuiCommand::new(id, bind!(weak, |tui, _, _| run(&tui))).bind(Bind::Off);
    let commands = KeymapLayer::global(vec![
        command("app.exit", |tui| {
            crate::features::title::clear(tui);
            crate::features::attention::program_status::clear(tui);
            tui.app.quit();
        })
        .title("Exit the app")
        .group("System")
        .palette()
        .slash(slash("exit", &["quit", "q"])),
        command("help.show", |tui| help::show(&tui.dialogs))
            .title("Help")
            .group("System")
            .palette()
            .slash(slash("help", &[])),
        command("session.list", crate::dialogs::session_list::show)
            .title("Switch session")
            .group("Session")
            .palette()
            .suggested(Condition::when(bind!(tui, |tui| tui.data.read(|state| !state.sessions().is_empty()))))
            .slash(slash("sessions", &["resume", "continue"])),
        command("session.new", |tui| crate::features::clear::clear(tui, false))
            .title("New session")
            .group("Session")
            .palette()
            .suggested(Condition::when(bind!(tui, |tui| matches!(*tui.route.borrow(), Route::Session { .. }))))
            .slash(slash("new", &[])),
        command("open.menu", crate::dialogs::open::show)
            .title("Open session or project")
            .group("Session")
            .palette()
            .slash(slash("open", &["projects", "project"])),
        command(COMMAND_PALETTE_COMMAND, |tui| {
            // A slash command waits for the session's pending interrupts, as a typed one does.
            let run: palette::Run = Rc::new(bind!(tui, |tui, id: &str| {
                let slash =
                    tui.keymap.commands().into_iter().any(|command| command.id == id && command.slash.is_some());
                let session = match tui.route() {
                    Route::Session { id } if slash => Some(id),
                    _ => None,
                };
                let id = id.to_owned();
                tui.prompt.after_interrupts(&tui, session.as_ref(), move |tui| {
                    tui.keymap.dispatch(&id, None);
                });
            }));
            palette::show(&tui.dialogs, crate::dialogs::settings::palette_options(tui), Some(run))
        }),
    ]);
    let exit = KeymapLayer::default()
        .enabled({
            let app = tui.app.clone();
            let textarea = tui.textarea.clone();
            Condition::when(move || {
                textarea
                    .borrow()
                    .as_ref()
                    .is_none_or(|textarea| !is_focused(&app, textarea) || textarea.text().is_empty())
            })
        })
        .bindings(["app.exit"]);
    let layers = [
        commands,
        KeymapLayer::default().bindings([COMMAND_PALETTE_COMMAND, "help.show", "opencode.settings"]),
        KeymapLayer::global(Vec::new()).bindings(["session.list", "session.new", "open.menu"]),
        exit,
    ];
    for layer in layers {
        match tui.keymap.layer(layer) {
            Ok(disposer) => tui.layers.borrow_mut().push(disposer),
            Err(error) => log::error!("app keymap layer: {error}"),
        }
    }
}

/// Application commands in palette order.
fn app_commands() -> Vec<String> {
    let names = |names: &[&str]| names.iter().map(|name| (*name).to_owned()).collect::<Vec<_>>();
    let numbered = |prefix: &str, count: usize| (1..=count).map(|n| format!("{prefix}{n}")).collect::<Vec<_>>();
    [
        names(&[COMMAND_PALETTE_COMMAND, "session.list", "session.new", "session.clear", "open.menu"]),
        numbered("session.quick_switch.", 9),
        names(&[
            "session.tab.next",
            "session.tab.previous",
            "session.tab.next_unread",
            "session.tab.previous_unread",
            "session.tab.close",
            "session.tab.reopen",
        ]),
        numbered("session.tab.select.", 10),
        names(&[
            "model.list",
            "model.cycle_recent",
            "model.cycle_recent_reverse",
            "model.cycle_favorite",
            "model.cycle_favorite_reverse",
            "agent.list",
            "usage.show",
            "mcp.list",
            "agent.cycle",
            "variant.cycle",
            "variant.list",
            "agent.cycle.reverse",
            "provider.connect",
            "opencode.highlights",
            "opencode.settings",
            "opencode.status",
            "opencode.update",
            "server.pair",
            "service.restart",
            "location.reload",
            "opencode.debug",
            "theme.switch",
            "theme.switch_mode",
            "theme.mode.lock",
            "help.show",
            "docs.open",
            "app.exit",
            "app.debug",
            "app.console",
            "terminal.suspend",
            "terminal.title.toggle",
            "app.toggle.animations",
            "app.toggle.file_context",
            "app.toggle.diffwrap",
            "app.toggle.paste_summary",
        ]),
    ]
    .concat()
}

fn install_theme(tui: &Rc<Tui>) {
    if let Some(colors) = tui.app.palette().as_ref().map(TerminalColors::from_palette) {
        tui.theme.borrow_mut().startup_palette(colors);
    }
    tui.app.on_theme_mode(bind!(tui, |tui, _, mode| {
        tui.theme.borrow_mut().terminal_mode(mode);
        tui.theme_changed();
    }));
    // Re-read the palette on `?997` so the system theme follows the terminal.
    tui.app.on_color_scheme(bind!(tui, |tui, _| {
        tui.theme.borrow_mut().colors_changed();
        tui.theme_changed();
    }));
    tui.app.on_palette(bind!(tui, |tui, _, palette| {
        tui.theme.borrow_mut().palette(TerminalColors::from_palette(palette));
        tui.theme_changed();
    }));
    let pending = tui.keymap.keymap().on_pending_sequence(bind!(tui, |tui, sequence| {
        if sequence.is_empty() && tui.restyle.take() {
            // After the key that ended the sequence, and any dialog its command opened.
            tui.app.defer(bind!(tui, |tui, _| tui.restyle_route()));
        }
    }));
    tui.layers.borrow_mut().push(pending);
    discover_themes(tui, |_| {});
}

/// Reads the custom themes from disk off the UI thread, after `prepare` ran there with the global config directory,
/// then applies them. One worker runs every `prepare` (a theme's write) and scan in the order asked, and only the
/// last scan asked for applies, so an earlier one that finishes later does not drop a theme a later write added.
pub(crate) fn discover_themes(tui: &Tui, prepare: impl FnOnce(&std::path::Path) + Send + 'static) {
    static WORKER: std::sync::OnceLock<opencode_local::serial::Serial> = std::sync::OnceLock::new();
    let Some(files) = &tui.files else {
        tui.theme_changed();
        return;
    };
    let config = files.config.path().parent().unwrap_or(files.config.path()).to_path_buf();
    let directories = opencode_ui::theme::config_directories(&config, std::path::Path::new(&tui.directory));
    let scan = tui.theme_scans.get() + 1;
    tui.theme_scans.set(scan);
    let (send, scanned) = tokio::sync::oneshot::channel();
    WORKER.get_or_init(|| opencode_local::serial::Serial::new("themes")).run(move || {
        prepare(&config);
        let _ = send.send(opencode_ui::theme::discover(&directories).ok());
    });
    tui.app.spawn(
        async move { scanned.await.ok().flatten() },
        bind!(tui, |tui, _, themes| {
            if tui.theme_scans.get() != scan {
                return;
            }
            match themes {
                Some(themes) => tui.theme.borrow_mut().custom_themes(themes),
                None => tui.theme.borrow_mut().discovery_failed(),
            }
            tui.theme_changed();
            crate::plugins::host::local_changed(&tui);
        }),
    );
}

/// The store's flushes and signals, subscribed before anything can flush or signal, until [`pump`] forwards them.
struct Wakeups {
    revisions: tokio::sync::watch::Receiver<u64>,
    signals: tokio::sync::broadcast::Receiver<Arc<opencode_api::generated::V2Event>>,
    /// A [`DataChanged`] is queued.
    pending: Arc<AtomicBool>,
}

fn install_wakeups(tui: &Rc<Tui>, connect: bool) -> Wakeups {
    let pending = Arc::new(AtomicBool::new(false));
    let clear = pending.clone();
    let weak = tui.weak();
    tui.app.on_message(move |_, _: &DataChanged| {
        // Cleared before the read, so a flush during the sync posts another wake.
        clear.store(false, Ordering::SeqCst);
        if let Some(tui) = weak.upgrade() {
            tui.sync();
        }
    });
    tui.app.on_message(bind!(tui, |tui, _, StatusChanged(state)| crate::features::overlays::connection_changed(
        &tui, state
    )));

    // Start offline so refresh waits for the first connection.
    if connect {
        tui.data.set_online(false);
    }
    Wakeups { revisions: tui.data.subscribe(), signals: tui.data.signals(), pending }
}

/// One task forwards store flushes (one queued wake at a time), store signals, and connection changes to the UI.
fn pump(app: &App, wakeups: Wakeups, mut status: Option<tokio::sync::watch::Receiver<events::State>>) {
    use tokio::sync::broadcast::error::RecvError;
    let Wakeups { mut revisions, mut signals, pending } = wakeups;
    let proxy = app.proxy();
    app.runtime().spawn(async move {
        let current = status.as_mut().map(|status| status.borrow_and_update().clone());
        if let Some(current) = current
            && !post(&proxy, StatusChanged(current)).await
        {
            return;
        }
        loop {
            let sent = tokio::select! {
                biased;
                changed = revisions.changed() => match changed {
                    Ok(()) => pending.swap(true, Ordering::SeqCst) || post(&proxy, DataChanged).await,
                    Err(_) => false,
                },
                signal = signals.recv() => match signal {
                    Ok(event) => post(&proxy, crate::features::events::Signal(event)).await,
                    Err(RecvError::Lagged(skipped)) => {
                        log::warn!("the UI skipped {skipped} server events; resyncing");
                        post(&proxy, crate::features::events::Lagged).await
                    }
                    Err(RecvError::Closed) => false,
                },
                changed = async { status.as_mut()?.changed().await.ok() }, if status.is_some() => match changed {
                    Some(()) => match status.as_mut().map(|status| status.borrow_and_update().clone()) {
                        Some(current) => post(&proxy, StatusChanged(current)).await,
                        None => true,
                    },
                    None => {
                        status = None;
                        true
                    }
                },
            };
            if !sent {
                return;
            }
        }
    });
}

/// Sends `message` to the UI, waiting while its queue is full (a burst, or a suspended terminal). False once the app
/// has ended. Meanwhile the store's revisions and the connection status coalesce, and its signals queue up to their
/// bound.
async fn post<M: Clone + Send + 'static>(proxy: &AppProxy, message: M) -> bool {
    let mut wait = Duration::from_millis(1);
    loop {
        match proxy.send(message.clone()) {
            Ok(()) => return true,
            Err(ProxyError::Closed) => return false,
            Err(ProxyError::Full) => {
                tokio::time::sleep(wait).await;
                wait = (wait * 2).min(Duration::from_millis(50));
            }
        }
    }
}

fn connect(tui: &Rc<Tui>) -> tokio::sync::watch::Receiver<events::State> {
    let (connection, _task) = opencode_store::connection::connect(&tui.data, events::Options::default());
    let state = connection.watch();
    *tui.connection.borrow_mut() = Some(connection);
    state
}

fn textarea_focused(app: &App, textarea: &Rc<RefCell<Option<Textarea>>>) -> Condition {
    let app = app.clone();
    let textarea = textarea.clone();
    Condition::when(move || textarea.borrow().as_ref().is_some_and(|textarea| is_focused(&app, textarea)))
}

fn is_focused(app: &App, textarea: &Textarea) -> bool {
    app.focused().is_some_and(|widget| widget.id() == textarea.id())
}

fn slash(name: &str, aliases: &[&str]) -> Slash {
    Slash::new(name).aliases(aliases.iter().copied())
}

fn app_theme(theme: &Theme) -> opentui::theme::Theme {
    opentui::theme::Theme {
        background: theme.background.base,
        foreground: theme.text.base,
        muted: theme.text.muted,
        ..opentui::theme::Theme::default()
    }
}

fn theme_options(app: &App, info: &Info, files: Option<&Files>) -> ThemeStateOptions {
    let theme = info.theme.clone().unwrap_or_default();
    let palette = files
        .and_then(|files| files.storage.as_ref())
        .and_then(|storage| storage.load("system-theme", &serde_json::Value::Null).ok())
        .and_then(|cached| serde_json::from_value(cached.get("colors")?.clone()).ok());
    ThemeStateOptions {
        name: theme.name,
        mode: theme.mode.map(|mode| match mode {
            ConfigMode::Dark => ModeSetting::Dark,
            ConfigMode::Light => ModeSetting::Light,
            ConfigMode::System => ModeSetting::System,
        }),
        terminal: app.theme_mode(),
        fallback: ThemeMode::Dark,
        palette,
    }
}

/// Carries out `ThemeState` effects; blocks on the config lock, so it runs on a blocking thread.
fn persist(files: &Files, effects: Vec<Effect>) {
    for effect in effects {
        let result = match effect {
            Effect::PersistName(name) => files
                .config
                .update(|config| config.theme.get_or_insert_default().name = Some(name))
                .map(drop)
                .map_err(|error| error.to_string()),
            Effect::PersistMode(mode) => files
                .config
                .update(|config| {
                    config.theme.get_or_insert_default().mode = Some(match mode {
                        ModeSetting::Dark => ConfigMode::Dark,
                        ModeSetting::Light => ConfigMode::Light,
                        ModeSetting::System => ConfigMode::System,
                    })
                })
                .map(drop)
                .map_err(|error| error.to_string()),
            Effect::CachePalette(colors) => match &files.storage {
                Some(storage) => storage
                    .update("system-theme", &serde_json::Value::Null, |value| {
                        *value = serde_json::json!({ "colors": colors });
                    })
                    .map(drop)
                    .map_err(|error| error.to_string()),
                None => Ok(()),
            },
            Effect::ProbePalette => Ok(()),
        };
        if let Err(error) = result {
            log::warn!("failed to save theme state: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::events::Signal;
    use events::{State, Status};
    use opencode_api::generated::V2Event;
    use opentui::testing::TestApp;

    fn state(status: Status) -> State {
        State { status, attempt: 0, error: None }
    }

    fn event(kind: &str) -> Arc<V2Event> {
        Arc::new(serde_json::from_value(serde_json::json!({ "id": "evt_1", "type": kind, "data": {} })).unwrap())
    }

    #[test]
    fn the_first_layer_follows_app_tsx() {
        let source = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../tui/src/app.tsx")).unwrap();
        let start = source.find("const appCommands = createMemo").unwrap();
        let end = start + source[start..].find("Keymap.createLayer").unwrap();
        let mut length = 0;
        let mut names = Vec::new();
        for line in source[start..end].lines().map(str::trim) {
            if let Some(count) = line.strip_prefix("...Array.from({ length: ").and_then(|rest| rest.split(' ').next()) {
                length = count.parse().unwrap();
            }
            let Some(name) = line.strip_prefix("name: ").and_then(|rest| rest.strip_suffix(',')) else { continue };
            match name.strip_suffix("${i + 1}`") {
                Some(prefix) => names.extend((1..=length).map(|n| format!("{}{n}", &prefix[1..]))),
                None if name == "COMMAND_PALETTE_COMMAND" => names.push(COMMAND_PALETTE_COMMAND.to_owned()),
                None => names.push(name.trim_matches('"').to_owned()),
            }
        }
        assert_eq!(app_commands(), names);
    }

    #[test]
    fn a_full_queue_delays_the_pump_but_never_stops_it() {
        let app = TestApp::new(10, 4);
        let seen = Rc::new(RefCell::new(Vec::<String>::new()));
        let pending = Arc::new(AtomicBool::new(false));
        let clear = pending.clone();
        let record = seen.clone();
        app.on_message(move |_, _: &DataChanged| {
            clear.store(false, Ordering::SeqCst);
            record.borrow_mut().push("data".into());
        });
        let record = seen.clone();
        app.on_message(move |_, Signal(event)| record.borrow_mut().push(event.tag().into()));
        let record = seen.clone();
        app.on_message(move |_, StatusChanged(state)| record.borrow_mut().push(format!("{:?}", state.status)));
        let (revision, revisions) = tokio::sync::watch::channel(0);
        let (signal, signals) = tokio::sync::broadcast::channel(16);
        let (status, statuses) = tokio::sync::watch::channel(state(Status::Connecting));

        let proxy = app.proxy();
        while proxy.post(|_| {}) != Err(ProxyError::Full) {}
        pump(&app, Wakeups { revisions, signals, pending }, Some(statuses));
        let send = |round: u64, kind: &str, next: Status| {
            // A pump that stopped has dropped the receivers.
            let _ = revision.send(round);
            let _ = signal.send(event(kind));
            let _ = status.send(state(next));
        };
        send(1, "server.connected", Status::Connected);
        std::thread::sleep(Duration::from_millis(100));
        let arrived = |want: &[&str]| {
            app.wait_until(Duration::from_secs(10), || {
                want.iter().all(|want| seen.borrow().iter().any(|seen| seen == want))
            })
        };
        assert!(arrived(&["data", "server.connected", "Connected"]), "after the queue drained: {:?}", seen.borrow());

        seen.borrow_mut().clear();
        send(2, "test.later", Status::Reconnecting);
        assert!(arrived(&["data", "test.later", "Reconnecting"]), "later: {:?}", seen.borrow());
    }
}
