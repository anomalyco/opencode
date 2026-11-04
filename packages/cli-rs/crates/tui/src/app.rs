//! The app (T.1): the shared context, mounting over any `App`, and the terminal entry point
//! (`packages/tui/src/app.tsx`). Structure: `docs/T.1.md`.

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use opencode_api::client::Client;
use opencode_api::events::{self, Connection};
use opencode_api::generated::SessionInfo;
use opencode_local::cli_config::{CliConfig, Info, Permissions, Resolved, ThemeMode as ConfigMode};
use opencode_local::paths::Paths;
use opencode_local::storage::Storage;
use opencode_store::{Data, Options};
use opencode_ui::dialog::{DialogKeymap, Dialogs, route_keys};
use opencode_ui::keymap::{
    Bind, COMMAND_PALETTE_COMMAND, GLOBAL_MODE, Keybinds, KeymapLayer, Slash, TuiCommand,
};
use opencode_ui::theme::{
    Effect, ModeSetting, TerminalColors, Theme, ThemeMode, ThemeState, ThemeStateOptions,
};
use opencode_ui::toast::Toasts;
use opencode_ui::{help, palette};
use opentui::keymap::{Condition, Disposer};
use opentui::prelude::*;
use opentui::widget::Textarea;

use crate::features::startup::{Args, Startup};
use crate::routes::{self, Route, RouteView};

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
}

/// The shared context. Held as `Rc<Tui>`; widget callbacks keep a [`Weak`].
pub struct Tui {
    pub app: App,
    pub data: Data,
    pub keymap: Rc<DialogKeymap>,
    pub dialogs: Dialogs,
    pub toasts: Toasts,
    pub theme: RefCell<ThemeState>,
    pub config: Resolved,
    pub directory: String,
    /// The prompt textarea while it has the keymap's edit bindings (E.2 fills it). The keymap's
    /// `textarea_enabled` holds while it is focused.
    pub textarea: Rc<RefCell<Option<Textarea>>>,
    /// Prompt history, drafts, and catalogs, shared by every prompt (E.2).
    pub prompt: crate::prompt::editor::Shared,
    /// The config as settings writes left it (E.18a).
    pub settings: crate::dialogs::settings::Live,
    /// The model and agent state (E.16).
    pub local: Rc<crate::dialogs::model::Local>,
    pub startup: Startup,
    /// The plugins (P.1).
    pub plugins: crate::plugins::host::Plugins,
    pub epilogue: crate::features::epilogue::Epilogue,
    /// The update notification and dialog state (E.18b).
    pub updates: crate::features::update_notification::Updates,
    pub(crate) location: crate::features::location::LocationState,
    pub(crate) overlays: crate::features::overlays::Overlays,
    pub(crate) title: crate::features::title::Title,
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
    files: Option<Files>,
    route: RefCell<Route>,
    view: RefCell<Option<Box<dyn RouteView>>>,
    /// The page theme the shell was last painted with.
    painted: RefCell<Theme>,
    /// A theme change arrived while a key sequence was pending; remount once it ends.
    restyle: Cell<bool>,
    seen: Cell<u64>,
    /// What keymap conditions and [`crate::dialogs::model::Local`] read, cached at each sync: they run inside
    /// keymap queries, which may come while the store is locked.
    has_sessions: Cell<bool>,
    routed: RefCell<Option<SessionInfo>>,
    connection: RefCell<Option<Connection>>,
    layers: RefCell<Vec<Disposer>>,
    this: Weak<Tui>,
}

#[derive(Clone)]
struct Files {
    config: CliConfig,
    storage: Option<Storage>,
    state: std::path::PathBuf,
}

/// Posted when the store flushed; at most one is queued.
struct DataChanged;

/// Posted when the event connection changed state.
struct StatusChanged(events::State);

impl Tui {
    pub fn route(&self) -> Route {
        self.route.borrow().clone()
    }

    pub fn weak(&self) -> Weak<Tui> {
        self.this.clone()
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

    /// The page theme.
    pub fn page(&self) -> Theme {
        self.theme.borrow().theme().page()
    }

    /// Replaces the route view and syncs the new one with everything.
    pub fn navigate(&self, route: Route) {
        let remount = self.view.borrow().is_some() && self.route() == route;
        if let Some(view) = self.view.borrow_mut().take() {
            view.root().detach();
        }
        *self.route.borrow_mut() = route.clone();
        self.cache();
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
        // A remount under an open dialog (a theme change) must not take the dialog's focus.
        if !self.dialogs.is_open() {
            view.focus(self);
        }
        *self.view.borrow_mut() = Some(view);
        crate::features::title::route_changed(self);
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
        self.cache();
        if let Some(view) = self.view.borrow().as_ref() {
            view.sync(self, &changes);
        }
        crate::features::title::sync(self, &changes);
        crate::features::events::sync(self, &changes);
        self.local.sync(&changes);
        crate::tabs::sync(self, &changes);
        crate::frame::refresh(self);
        crate::features::attention::program_status::sync(self);
    }

    fn cache(&self) {
        let route = self.route();
        let (has_sessions, routed) = self.data.read(|state| {
            let routed = match &route {
                Route::Session { id } => state.session(id).cloned(),
                _ => None,
            };
            (!state.sessions().is_empty(), routed)
        });
        self.has_sessions.set(has_sessions);
        *self.routed.borrow_mut() = routed;
    }

    /// The routed session as the last sync read it.
    pub(crate) fn routed(&self) -> Option<SessionInfo> {
        self.routed.borrow().clone()
    }

    /// Syncs the route view with everything, after state outside the store changed.
    pub(crate) fn resync(&self) {
        if let Some(view) = self.view.borrow().as_ref() {
            view.sync(self, &opencode_store::Changes::everything());
        }
        self.app.request_redraw();
    }

    /// Runs `ThemeState` effects off the UI thread, shows a theme error, and repaints on a change.
    pub(crate) fn theme_changed(&self) {
        let (effects, error) = {
            let mut theme = self.theme.borrow_mut();
            (theme.take_effects(), theme.take_error())
        };
        if let Some(error) = error {
            self.toasts.theme_error(error);
        }
        if let Some(files) = self.files.clone() {
            let effects: Vec<Effect> = effects
                .into_iter()
                .filter(|effect| !matches!(effect, Effect::ProbePalette))
                .collect();
            if !effects.is_empty() {
                self.app
                    .runtime()
                    .spawn_blocking(move || persist(&files, effects));
            }
        }
        let theme = self.page();
        if *self.painted.borrow() == theme {
            return;
        }
        *self.painted.borrow_mut() = theme.clone();
        self.app.set_theme(app_theme(&theme));
        self.dialogs.set_theme(theme.clone());
        self.toasts.set_theme(theme);
        // The route view takes its colors when it mounts, so it remounts. TS restyles in place and keeps
        // a half-typed sequence such as `<leader>l`; the new view's focus would clear it here, so wait.
        if self.keymap.keymap().has_pending_sequence() {
            self.restyle.set(true);
            return;
        }
        self.restyle_route();
    }

    /// Remounts the route view in the current theme, keeping the prompt focused if it was.
    fn restyle_route(&self) {
        self.restyle.set(false);
        // Before the first route mounts there is nothing to repaint.
        if self.view.borrow().is_none() {
            return;
        }
        let prompt = self
            .textarea
            .borrow()
            .as_ref()
            .is_some_and(|textarea| is_focused(&self.app, textarea));
        self.navigate(self.route());
        let textarea = self.textarea.borrow().clone();
        if let Some(textarea) = textarea.filter(|_| prompt && !self.dialogs.is_open()) {
            self.app.focus(&textarea);
        }
    }
}

/// Builds the TUI on `app`. The returned handle owns it; drop it after the app stops.
pub fn mount(app: &App, deps: Deps) -> Rc<Tui> {
    mount_with(app, deps, Args::default())
}

/// [`mount`] with the startup arguments.
pub fn mount_with(app: &App, mut deps: Deps, args: Args) -> Rc<Tui> {
    // `--auto` wins over `session.permissions` (`context/permission.tsx`).
    if args.auto {
        deps.config.permissions = Permissions::Autoaccept;
    }
    let runtime = app.runtime();
    let _guard = runtime.enter();
    let data = Data::with_runtime(
        deps.client.clone(),
        Options {
            directory: deps.directory.clone(),
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
    let keybinds =
        Keybinds::resolve(&deps.config.keybinds(), !cfg!(windows)).unwrap_or_else(|error| {
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

    let page = theme.theme().page();
    app.set_theme(app_theme(&page));
    let shell = View::new(app).column().grow(1.0).basis(Length::Auto);
    app.root().add(&shell);
    let toasts = Toasts::new(app, page.clone(), &shell);
    let dialogs = Dialogs::new(app, keymap.clone(), page.clone());
    let local_files = deps
        .roots
        .as_ref()
        .map(|roots| crate::dialogs::model::Files {
            state: roots.paths.state.clone(),
            storage: files.as_ref().and_then(|files| files.storage.clone()),
        });

    let settings = crate::dialogs::settings::Live::new(
        deps.config.info.clone(),
        files.as_ref().map(|files| files.config.clone()),
    );
    let plugins = crate::plugins::host::registry(&deps.config.info);
    let tui = Rc::new_cyclic(|this: &Weak<Tui>| Tui {
        local: crate::dialogs::model::Local::new(
            app,
            data.clone(),
            dialogs.clone(),
            toasts.clone(),
            local_files,
            crate::dialogs::model::route_fn(this.clone()),
            crate::dialogs::model::location_fn(this.clone()),
        ),
        app: app.clone(),
        data,
        keymap,
        dialogs,
        toasts,
        theme: RefCell::new(theme),
        config: deps.config,
        directory: deps.directory,
        textarea,
        prompt: crate::prompt::editor::Shared::new(
            app,
            deps.roots.as_ref().map(|roots| roots.paths.state.clone()),
        ),
        settings,
        startup: Startup::new(args),
        plugins,
        epilogue: Default::default(),
        updates: Default::default(),
        location: Default::default(),
        overlays: Default::default(),
        title: Default::default(),
        events: Default::default(),
        attention: Default::default(),
        tabs: Default::default(),
        frame: crate::frame::Frame::new(app, this.clone()),
        panels: Default::default(),
        terminals: Default::default(),
        files,
        route: RefCell::new(Route::Home),
        view: RefCell::new(None),
        painted: RefCell::new(page),
        restyle: Cell::new(false),
        seen: Cell::new(0),
        has_sessions: Cell::new(false),
        routed: RefCell::new(None),
        connection: RefCell::new(None),
        layers: RefCell::new(Vec::new()),
        this: this.clone(),
    });

    install_keys(&tui);
    install_theme(&tui);
    install_wakeups(&tui, deps.events);
    crate::tabs::install(&tui);
    crate::terminal::install(&tui);
    crate::frame::install(&tui, &shell);
    crate::features::clear::install(&tui);
    crate::features::quick_switch::install(&tui);
    crate::features::events::install(&tui);
    crate::features::overlays::install(&tui);
    crate::features::title::install(&tui);
    crate::features::attention::notify::install(&tui);
    let system = crate::features::system_commands::install(&tui);
    tui.layers.borrow_mut().extend(system);
    crate::features::links::install(&tui);
    crate::dialogs::settings::install(&tui);
    crate::dialogs::mcp::install(&tui);
    crate::dialogs::theme_list::install(&tui);
    crate::dialogs::status::install(&tui);
    crate::dialogs::pair::install(&tui);
    crate::features::highlights::install(&tui, deps.continue_);
    crate::features::devtools::mount(&tui, &shell);
    crate::dialogs::model::install(&tui);
    crate::plugins::host::install(&tui);
    tui.startup.aim(&deps.route, deps.continue_);
    tui.navigate(deps.route);
    crate::features::startup::run(&tui, deps.continue_);
    tui
}

/// Runs the TUI on the terminal until it quits.
pub fn run(launch: Launch) -> opentui::Result<()> {
    let mut options = AppOptions {
        exit_on_ctrl_c: false,
        // `terminal.suspend` (E.20) owns Ctrl+Z, so `keybinds` can turn it off.
        suspend_on_ctrl_z: false,
        // `ThemeState` follows the palette when the `system` theme is active.
        palette_size: 16,
        ..AppOptions::default()
    };
    options.host.terminal.mouse =
        crate::features::system_commands::mouse_tracking(&launch.deps.config);
    let app = App::new(options)?;
    let tui = mount_with(&app, launch.deps, launch.args);
    // Tests start the editor context with their own source; the real TUI reads the environment.
    crate::prompt::editor_context::start(&tui, crate::prompt::editor_context::Source::from_env());
    let result = app.run();
    let epilogue = crate::features::epilogue::text(&tui);
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
    tui.app.on_key(move |cx, _| {
        let Some(tui) = weak.upgrade() else { return };
        if let Some(previous) = timer.take() {
            cx.cancel_timer(previous);
        }
        let Some(deadline) = tui.keymap.leader_deadline() else {
            return;
        };
        let weak = tui.weak();
        timer.set(Some(cx.set_timeout(
            deadline.saturating_duration_since(cx.now()),
            move |cx| {
                if let Some(tui) = weak.upgrade() {
                    tui.keymap.expire_leader(cx.now());
                }
            },
        )));
    });

    // As `app.tsx:1303-1335`: the commands live in a global layer without bindings, so the palette
    // reaches them over a dialog, and separate layers bind their keys.
    let weak = tui.weak();
    let command = |id: &str, run: fn(&Tui)| {
        let weak = weak.clone();
        TuiCommand::new(id, move |_, _| {
            if let Some(tui) = weak.upgrade() {
                run(&tui);
            }
        })
        .bind(Bind::Off)
    };
    let bindings = |mode: Option<&str>, names: &[&str]| KeymapLayer {
        mode: mode.map(str::to_owned),
        bindings: names.iter().map(|name| (*name).to_owned()).collect(),
        ..KeymapLayer::default()
    };
    let commands = KeymapLayer {
        mode: Some(GLOBAL_MODE.to_owned()),
        commands: vec![
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
                .suggested(has_sessions(&tui.weak()))
                .slash(slash("sessions", &["resume", "continue"])),
            command("session.new", |tui| tui.navigate(Route::Home))
                .title("New session")
                .group("Session")
                .palette()
                .suggested(route_is_session(&tui.weak()))
                .slash(slash("new", &[])),
            command("open.menu", crate::dialogs::open::show)
                .title("Open session or project")
                .group("Session")
                .palette()
                .slash(slash("open", &["projects", "project"])),
            command(COMMAND_PALETTE_COMMAND, |tui| {
                palette::show(&tui.dialogs, crate::dialogs::settings::palette_options(tui))
            }),
        ],
        ..KeymapLayer::default()
    };
    // `app.exit`'s keys work unless the focused prompt has text (`app.tsx:1329-1335`).
    let exit = KeymapLayer {
        enabled: {
            let app = tui.app.clone();
            let textarea = tui.textarea.clone();
            Condition::when(move || {
                textarea.borrow().as_ref().is_none_or(|textarea| {
                    !is_focused(&app, textarea) || textarea.text().is_empty()
                })
            })
        },
        ..bindings(None, &["app.exit"])
    };
    let layers = [
        commands,
        // Part of `appBindingCommands` (`app.tsx:150-186`); E.20 binds its own commands.
        bindings(
            None,
            &[COMMAND_PALETTE_COMMAND, "help.show", "opencode.settings"],
        ),
        // `appGlobalBindingCommands` (`app.tsx:117`).
        bindings(
            Some(GLOBAL_MODE),
            &["session.list", "session.new", "open.menu"],
        ),
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
        tui.theme.borrow_mut().palette(colors);
    }
    let weak = tui.weak();
    tui.app.on_theme_mode(move |_, mode| {
        let Some(tui) = weak.upgrade() else { return };
        tui.theme.borrow_mut().terminal_mode(mode);
        tui.theme_changed();
    });
    let weak = tui.weak();
    let pending = tui.keymap.keymap().on_pending_sequence(move |sequence| {
        let Some(tui) = weak.upgrade() else { return };
        if sequence.is_empty() && tui.restyle.take() {
            // After the key that ended the sequence, and any dialog its command opened.
            let weak = tui.weak();
            tui.app.defer(move |_| {
                if let Some(tui) = weak.upgrade() {
                    tui.restyle_route();
                }
            });
        }
    });
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
    let weak = tui.weak();
    tui.app.spawn(
        async move {
            tokio::task::spawn_blocking(move || opencode_ui::theme::discover(&directories))
                .await
                .ok()
                .and_then(Result::ok)
        },
        move |_, themes| {
            let Some(tui) = weak.upgrade() else { return };
            match themes {
                Some(themes) => tui.theme.borrow_mut().custom_themes(themes),
                None => tui.theme.borrow_mut().discovery_failed(),
            }
            tui.theme_changed();
        },
    );
}

/// Wakes the UI on store flushes and connection changes, one queued wake at a time.
fn install_wakeups(tui: &Rc<Tui>, connect: bool) {
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
    let weak = tui.weak();
    tui.app.on_message(move |_, StatusChanged(state)| {
        if let Some(tui) = weak.upgrade() {
            crate::features::overlays::connection_changed(&tui, state);
        }
    });

    let proxy = tui.app.proxy();
    let mut revisions = tui.data.subscribe();
    tui.app.runtime().spawn(async move {
        while revisions.changed().await.is_ok() {
            if !pending.swap(true, Ordering::SeqCst) && proxy.send(DataChanged).is_err() {
                return;
            }
        }
    });

    if !connect {
        return;
    }
    let (connection, _task) =
        opencode_store::connection::connect(&tui.data, events::Options::default());
    let mut state = connection.watch();
    let proxy = tui.app.proxy();
    tui.app.runtime().spawn(async move {
        loop {
            let current = state.borrow_and_update().clone();
            if proxy.send(StatusChanged(current)).is_err() || state.changed().await.is_err() {
                return;
            }
        }
    });
    *tui.connection.borrow_mut() = Some(connection);
}

fn textarea_focused(app: &App, textarea: &Rc<RefCell<Option<Textarea>>>) -> Condition {
    let app = app.clone();
    let textarea = textarea.clone();
    Condition::when(move || {
        textarea
            .borrow()
            .as_ref()
            .is_some_and(|textarea| is_focused(&app, textarea))
    })
}

fn is_focused(app: &App, textarea: &Textarea) -> bool {
    app.focused()
        .is_some_and(|widget| widget.id() == textarea.id())
}

fn route_is_session(tui: &Weak<Tui>) -> Condition {
    let weak = tui.clone();
    Condition::When(Rc::new(move || {
        weak.upgrade()
            .is_some_and(|tui| matches!(*tui.route.borrow(), Route::Session { .. }))
    }))
}

fn has_sessions(tui: &Weak<Tui>) -> Condition {
    let weak = tui.clone();
    Condition::When(Rc::new(move || {
        weak.upgrade().is_some_and(|tui| tui.has_sessions.get())
    }))
}

fn slash(name: &str, aliases: &[&str]) -> Slash {
    Slash {
        name: name.to_owned(),
        aliases: aliases.iter().map(|alias| (*alias).to_owned()).collect(),
        arguments: false,
    }
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
