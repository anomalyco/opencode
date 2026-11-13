//! The app (T.1): the shared context, mounting over any `App`, and the terminal entry point
//! (`packages/tui/src/app.tsx`). Structure: `docs/T.1.md`.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use opencode_api::client::Client;
use opencode_api::events::{self, Connection};
use opencode_local::cli_config::{CliConfig, Info, Resolved, ThemeMode as ConfigMode};
use opencode_local::paths::Paths;
use opencode_local::storage::Storage;
use opencode_store::{Data, Options};
use opencode_ui::dialog::{DialogKeymap, Dialogs, route_keys};
use opencode_ui::keymap::{COMMAND_PALETTE_COMMAND, Keybinds, Slash};
use opencode_ui::theme::{Effect, ModeSetting, TerminalColors, ThemeMode, ThemeState, ThemeStateOptions};
use opencode_ui::toast::Toasts;
use opencode_ui::{help, palette};
use opentui::app::ProxyError;
use opentui::widget::Textarea;

use crate::features::startup::{Args, Startup};
use crate::prelude::*;
use crate::routes::{self, RouteView};

/// What the TUI is built from. Tests pass an in-memory client and no roots.
pub struct Deps {
    pub client: Client,
    /// The default location directory (`data.location.default()`).
    pub directory: String,
    pub config: Resolved,
    /// Real config and state roots, for `cli.json` and TUI storage writes. `None` writes nothing.
    pub roots: Option<Roots>,
    pub route: Route,
    /// `--continue`: open the newest root session of `directory`.
    pub continue_: bool,
    /// Open the `/api/event` connection.
    pub events: bool,
    /// The built-ins from other crates, in TS order: Mermaid and LaTeX. `tui` does not depend on them, so an edit
    /// there does not rebuild it.
    pub builtins: Vec<opencode_plugin::Builtin>,
}

pub struct Roots {
    pub paths: Paths,
    /// The TUI storage channel (`OPENCODE_TUI_CHANNEL`, else the channel).
    pub storage_channel: String,
}

/// What [`run`] needs besides [`Deps`].
pub struct Launch {
    pub deps: Deps,
    pub args: Args,
    /// Kept alive while the TUI runs: dropping a standalone connection stops its server.
    pub keep: Box<dyn std::any::Any>,
    /// External plugins to discover and load (P.4).
    pub plugins: Option<crate::plugins::host::External>,
}

/// The shared context. Held as `Rc<Tui>`; widget callbacks keep a [`Weak`].
pub struct Tui {
    pub app: App,
    pub data: Data,
    pub keymap: Rc<DialogKeymap>,
    pub dialogs: Dialogs,
    pub toasts: Toasts,
    pub theme: RefCell<ThemeState>,
    pub directory: String,
    /// The prompt textarea while it has the keymap's edit bindings (E.2 fills it). The keymap's
    /// `textarea_enabled` holds while it is focused.
    pub textarea: Rc<RefCell<Option<Textarea>>>,
    /// Prompt history, drafts, and catalogs, shared by every prompt (E.2).
    pub prompt: crate::prompt::editor::Shared,
    /// The live config: settings writes and `cli.json` edits replace it (E.18a).
    pub settings: crate::dialogs::settings::Live,
    /// The model and agent state (E.16).
    pub local: Rc<crate::local::Local>,
    pub startup: Startup,
    /// The plugins (P.1).
    pub plugins: crate::plugins::host::Plugins,
    /// What the plugins' reads asked the host to load (O-67).
    pub(crate) reads: crate::plugins::host::Reads,
    pub epilogue: crate::features::epilogue::Epilogue,
    /// The update notification and dialog state (E.18b).
    pub updates: crate::features::update_notification::Updates,
    pub(crate) location: crate::features::location::LocationState,
    pub(crate) overlays: crate::features::overlays::Overlays,
    pub(crate) title: crate::features::title::Title,
    /// Markdown documents that link session IDs (#63224).
    pub(crate) session_links: crate::features::session_links::Registry,
    pub(crate) events: crate::features::events::Events,
    /// Focus and program status (E.19a).
    pub attention: crate::features::attention::notify::Attention,
    /// Session tabs (E.12).
    pub tabs: crate::tabs::Tabs,
    /// The tab strip or rail around the route, and the pane sizes (E.12).
    pub frame: crate::frame::Frame,
    /// Plugin side panels (E.12).
    pub panels: crate::panel::Panels,
    /// Session terminals (E.13a).
    pub terminals: crate::terminal::Terminals,
    /// The client MCP socket (E.13b).
    pub client_mcp: crate::client_mcp::ClientMcp,
    /// What the composer keeps across session views (E.13b).
    pub composer: crate::composer::Memory,
    files: Option<Files>,
    route: RefCell<Route>,
    view: RefCell<Option<Box<dyn RouteView>>>,
    /// The page theme the shell was last painted with, which the route view's parts read when they paint.
    painted: Live,
    /// A theme change arrived while a key sequence was pending; remount once it ends.
    restyle: Cell<bool>,
    seen: Cell<u64>,
    /// The open dialogs and viewers that follow the store: [`Tui::follow`].
    followers: RefCell<Vec<Follower>>,
    connection: RefCell<Option<Connection>>,
    layers: RefCell<Vec<Disposer>>,
    this: Weak<Tui>,
}

/// A [`Tui::follow`] registration; false once its target is gone.
type Follower = Rc<dyn Fn(&Tui, &Changes) -> bool>;

#[derive(Clone)]
struct Files {
    config: CliConfig,
    storage: Option<Storage>,
    state: std::path::PathBuf,
}

/// Posted when the store flushed; at most one is queued.
#[derive(Clone)]
struct DataChanged;

/// Posted when the event connection changed state.
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

    /// The resolved config now (`useConfig().data`). Keep the borrow short: a change replaces it.
    pub fn config(&self) -> std::cell::Ref<'_, Resolved> {
        self.settings.config()
    }

    /// TUI storage (`useStorage`), when the TUI has real roots.
    pub fn storage(&self) -> Option<Storage> {
        self.files.as_ref().and_then(|files| files.storage.clone())
    }

    /// The state directory (TS `useTuiPaths().state`), when the TUI has real roots.
    pub fn state_dir(&self) -> Option<std::path::PathBuf> {
        self.files.as_ref().map(|files| files.state.clone())
    }

    /// The event connection's state while it is open.
    pub fn connection_watch(&self) -> Option<tokio::sync::watch::Receiver<events::State>> {
        self.connection.borrow().as_ref().map(Connection::watch)
    }

    /// The page theme the views paint in, shared: it changes in place on a theme switch, before the views restyle.
    pub fn live_theme(&self) -> Live {
        self.painted.clone()
    }

    /// The page theme.
    pub fn page(&self) -> Theme {
        self.theme.borrow().theme().page()
    }

    /// Replaces the route view and syncs the new one with everything.
    pub fn navigate(&self, route: Route) {
        // Going home from home to another location is a navigation, not a remount.
        let remount =
            self.view.borrow().is_some() && self.route() == route && !crate::features::location::pending(self);
        // Mounting may move the focus (a docked panel, a pending permission); an open dialog keeps it.
        let dialog = self.dialogs.is_open().then(|| self.app.focused());
        if let Some(view) = self.view.borrow_mut().take() {
            view.root().detach();
        }
        *self.route.borrow_mut() = route.clone();
        // A remount (a theme change) keeps the home's location.
        if route == Route::Home && !remount {
            crate::features::location::home(self);
        }
        // The tab strip shows before the view lays out, so a transcript sticks to the bottom it ends with.
        crate::tabs::route_changed(self);
        crate::frame::refresh(self);
        let view = routes::mount(self, &route);
        self.frame.main().add(&view.root());
        view.sync(self, &opencode_store::Changes::everything());
        crate::frame::mount_app(self, remount);
        // A remount under an open dialog (a theme change, a plugin toggled in `/plugins`) must not take the dialog's
        // focus; the new view takes it once the dialog closes, as the old one would have.
        let target = view.focus_target();
        match dialog {
            None => {
                if let Some(widget) = target {
                    widget.focus();
                }
            }
            Some(dialog) => {
                if let Some(widget) = target {
                    self.dialogs.refocus(&widget);
                }
                match dialog {
                    Some(widget) => widget.focus(),
                    None => self.app.blur(),
                }
            }
        }
        *self.view.borrow_mut() = Some(view);
        crate::features::title::route_changed(self);
        crate::features::devtools::route_changed(self);
        crate::features::attention::program_status::sync(self);
        self.app.request_redraw();
    }

    /// Passes what changed since the last sync to the route view.
    fn sync(&self) {
        let (revision, changes) = self.data.changes_since(self.seen.get());
        self.seen.set(revision);
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

    /// Calls `sync` with `target` and the store's changes at each flush, after the route view, until the returned
    /// disposer runs or `target` is gone. An open dialog or viewer follows the store this way, on the route view's
    /// update path (O-104).
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

    /// Syncs the route view with no store changes, after view state outside the store changed (E.13b's composer).
    pub(crate) fn sync_view(&self) {
        if let Some(view) = self.view.borrow().as_ref() {
            view.sync(self, &opencode_store::Changes::default());
        }
        crate::frame::sync_app(self, &opencode_store::Changes::default());
        self.app.request_redraw();
    }

    /// Runs `ThemeState` effects off the UI thread, shows a theme error, and repaints on a change.
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
        let theme = self.page();
        if self.painted.get() == theme {
            return;
        }
        self.painted.set(theme.clone());
        self.app.set_theme(app_theme(&theme));
        self.dialogs.set_theme(theme.clone());
        self.toasts.set_theme(theme);
        // The route view restyles in place, as TS's does. A plugin route mounts again, and its focus would clear a
        // half-typed sequence such as `<leader>l` that TS keeps, so wait for that to end.
        if matches!(self.route(), Route::Plugin { .. }) && self.keymap.keymap().has_pending_sequence() {
            self.restyle.set(true);
            return;
        }
        self.restyle_route();
    }

    /// Restyles the route view for the current theme in place, or mounts a plugin route again, keeping the prompt
    /// focused if it was.
    fn restyle_route(&self) {
        self.restyle.set(false);
        // Before the first route mounts there is nothing to repaint.
        if self.view.borrow().is_none() {
            return;
        }
        // In place, the focus, the scroll positions and every widget's state stay where they are.
        if self.view.borrow().as_ref().is_some_and(|view| view.restyle(self)) {
            // The `app` slot's plugin claims take the theme when they render, so they render again.
            crate::frame::mount_app(self, true);
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

/// [`mount`] with the startup arguments.
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
    let local_files = deps.roots.as_ref().map(|roots| crate::local::Files {
        state: roots.paths.state.clone(),
        storage: files.as_ref().and_then(|files| files.storage.clone()),
    });

    let plugins = crate::plugins::host::registry(&deps.config.info, deps.builtins);
    let settings =
        crate::dialogs::settings::Live::new(deps.config, args.auto, files.as_ref().map(|files| files.config.clone()));
    let tui = Rc::new_cyclic(|this: &Weak<Tui>| Tui {
        local: crate::local::Local::new(app, data.clone(), dialogs.clone(), toasts.clone(), local_files, this.clone()),
        app: app.clone(),
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
        session_links: Default::default(),
        events: Default::default(),
        attention: Default::default(),
        tabs: Default::default(),
        frame: crate::frame::Frame::new(app, this.clone()),
        panels: Default::default(),
        terminals: Default::default(),
        client_mcp: Default::default(),
        composer: Default::default(),
        files,
        route: RefCell::new(Route::Home),
        view: RefCell::new(None),
        painted: Live::new(page),
        restyle: Cell::new(false),
        seen: Cell::new(0),
        followers: RefCell::default(),
        connection: RefCell::new(None),
        layers: RefCell::new(Vec::new()),
        this: this.clone(),
    });

    install_keys(&tui);
    install_theme(&tui);
    // Before the connection starts: a broadcast receiver gets only later events, and the first `server.connected`
    // (terminal support, the client MCP) can arrive before mount ends. TS subscribes synchronously during mount, before
    // its event stream yields anything.
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
    crate::plugins::host::install(&tui);
    tui.startup.aim(&deps.route, deps.continue_);
    tui.navigate(deps.route);
    // After the first route's reads, as in TS, where they start during mount and the event stream connects later.
    // Otherwise `session.active` can answer first and read again the running sessions the route's family read brings.
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
        // `terminal.suspend` (E.20) owns Ctrl+Z, so `keybinds` can turn it off.
        suspend_on_ctrl_z: false,
        // `ThemeState` follows the palette when the `system` theme is active.
        palette_size: 16,
        // `--print-logs` records and stray stderr writes would draw over the screen; they go to the console and
        // reach the real stderr once the terminal is restored.
        capture_stderr: true,
        // `autoFocus: false` (`app.tsx:258`): a click moves no focus unless its handler does.
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
    // Only the TUI on the real terminal plays sounds out loud; tests and harnesses mix them without a device.
    run_on(App::new(options)?, launch, |tui| {
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
    // Tests start the editor context with their own source; the real TUI reads the environment.
    crate::prompt::editor_context::start(&tui, crate::prompt::editor_context::Source::from_env());
    let result = app.run();
    let epilogue = crate::features::epilogue::text(&tui);
    // As TS's plugin context on exit: every active plugin is disposed while the TUI is still alive.
    tui.plugins.deactivate_all();
    // Their storage writes reach the disk before the process can exit; UI effects and replies are not waited for.
    crate::plugins::host::flush_storage(&tui);
    drop(tui);
    drop(launch.keep);
    result?;
    if let Some(text) = epilogue {
        println!("{text}");
    }
    Ok(())
}

fn install_keys(tui: &Rc<Tui>) {
    // Console copy, then the selection keys, go before the keymap (E.20).
    crate::features::console_copy::install(tui);
    crate::features::selection::install(tui);
    // A focused terminal takes keys before the keymap (E.13a).
    crate::terminal::install_keys(tui);
    route_keys(&tui.app, tui.keymap.clone());
    // The leader sequence expires on a timer (`leader.timeout`).
    let weak = tui.weak();
    let timer = Rc::new(Cell::new(None::<TimerId>));
    tui.app.on_key(bind!(weak, |tui, cx, _| {
        if let Some(previous) = timer.take() {
            cx.cancel_timer(previous);
        }
        let Some(deadline) = tui.keymap.leader_deadline() else { return };
        timer.set(Some(cx.set_timeout(
            deadline.saturating_duration_since(cx.now()),
            bind!(tui, |tui, cx| {
                tui.keymap.expire_leader(cx.now());
            }),
        )));
    }));

    // As `app.tsx:1303-1335`: the commands live in a global layer without bindings, so the palette
    // reaches them over a dialog, and separate layers bind their keys.
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
    // `app.exit`'s keys work unless the focused prompt has text (`app.tsx:1329-1335`).
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
        // Part of `appBindingCommands` (`app.tsx:150-186`); E.20 binds its own commands.
        KeymapLayer::default().bindings([COMMAND_PALETTE_COMMAND, "help.show", "opencode.settings"]),
        // `appGlobalBindingCommands` (`app.tsx:117`).
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

fn install_theme(tui: &Rc<Tui>) {
    if let Some(colors) = tui.app.palette().as_ref().map(TerminalColors::from_palette) {
        tui.theme.borrow_mut().startup_palette(colors);
    }
    tui.app.on_theme_mode(bind!(tui, |tui, _, mode| {
        tui.theme.borrow_mut().terminal_mode(mode);
        tui.theme_changed();
    }));
    // TS reads the palette again on `?997` (`theme.tsx:263-268`), so `system` follows a terminal theme switch.
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
    // Custom themes are read from disk off the UI thread, then applied.
    let Some(files) = &tui.files else {
        tui.theme_changed();
        return;
    };
    let directories = opencode_ui::theme::config_directories(
        files.config.path().parent().unwrap_or(files.config.path()),
        std::path::Path::new(&tui.directory),
    );
    tui.app.spawn(
        async move {
            tokio::task::spawn_blocking(move || opencode_ui::theme::discover(&directories))
                .await
                .ok()
                .and_then(Result::ok)
        },
        bind!(tui, |tui, _, themes| {
            match themes {
                Some(themes) => tui.theme.borrow_mut().custom_themes(themes),
                None => tui.theme.borrow_mut().discovery_failed(),
            }
            tui.theme_changed();
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

/// Handles the wakes on the UI thread and subscribes to the store.
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

    // Offline until the connection reports connected, so reads behind `refresh` wait for it as in TS.
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

/// Starts the event connection and returns its state.
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

/// The opentui theme the renderer clears with: the page background and text.
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

    // Expected: a full UI queue (a burst, a suspended terminal) delays the pump's store revisions, signals and
    // connection changes; once it drains they arrive, and later ones still do (reviews bigboi-1 and carbon-2).
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
