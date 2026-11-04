//! The app (T.1): the shared context, mounting over any `App`, and the terminal entry point
//! (`packages/tui/src/app.tsx`). Structure: `docs/T.1.md`.

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use opencode_api::client::{Client, RequestOptions};
use opencode_api::events::{self, Connection};
use opencode_api::generated::{SessionListInput, SessionListInputOrder};
use opencode_local::cli_config::{CliConfig, Info, Resolved, ThemeMode as ConfigMode};
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

use crate::routes::{self, Route, RouteView};
use crate::status::Status;

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
    files: Option<Files>,
    route: RefCell<Route>,
    view: RefCell<Option<Box<dyn RouteView>>>,
    main: View,
    status: Status,
    seen: Cell<u64>,
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

    /// The page theme.
    pub fn page(&self) -> Theme {
        self.theme.borrow().theme().page()
    }

    /// Replaces the route view and syncs the new one with everything.
    pub fn navigate(&self, route: Route) {
        if let Some(view) = self.view.borrow_mut().take() {
            view.root().detach();
        }
        *self.route.borrow_mut() = route.clone();
        let view = routes::mount(self, &route);
        self.main.add(&view.root());
        view.sync(self, &opencode_store::Changes::everything());
        view.focus(self);
        *self.view.borrow_mut() = Some(view);
        crate::features::title::route_changed(self);
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
    }

    /// Runs `ThemeState` effects off the UI thread, shows a theme error, and repaints on a change.
    fn theme_changed(&self) {
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
        self.app.set_theme(app_theme(&theme));
        self.dialogs.set_theme(theme.clone());
        self.toasts.set_theme(theme);
        self.navigate(self.route());
    }
}

/// Builds the TUI on `app`. The returned handle owns it; drop it after the app stops.
pub fn mount(app: &App, deps: Deps) -> Rc<Tui> {
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
    let main = View::new(app).column().grow(1.0).basis(Length::Auto);
    let status = Status::new(app, &page, &deps.directory);
    shell.add(&main);
    shell.add(status.root());
    app.root().add(&shell);
    let toasts = Toasts::new(app, page.clone(), &shell);
    let dialogs = Dialogs::new(app, keymap.clone(), page);

    let tui = Rc::new_cyclic(|this| Tui {
        app: app.clone(),
        data,
        keymap,
        dialogs,
        toasts,
        theme: RefCell::new(theme),
        config: deps.config,
        directory: deps.directory,
        textarea,
        files,
        route: RefCell::new(Route::Home),
        view: RefCell::new(None),
        main,
        status,
        seen: Cell::new(0),
        connection: RefCell::new(None),
        layers: RefCell::new(Vec::new()),
        this: this.clone(),
    });

    install_keys(&tui);
    install_theme(&tui);
    install_wakeups(&tui, deps.events);
    crate::features::events::install(&tui);
    crate::features::overlays::install(&tui);
    crate::features::title::install(&tui);
    crate::features::system_commands::install(&tui);
    tui.navigate(deps.route);
    if deps.continue_ {
        continue_latest(&tui);
    }
    crate::features::startup::run(&tui);
    tui
}

/// Runs the TUI on the terminal until it quits.
pub fn run(launch: Launch) -> opentui::Result<()> {
    let options = AppOptions {
        exit_on_ctrl_c: false,
        // `ThemeState` follows the palette when the `system` theme is active.
        palette_size: 16,
        title: Some("OpenCode".to_owned()),
        ..AppOptions::default()
    };
    let app = App::new(options)?;
    let tui = mount(&app, launch.deps);
    let result = app.run();
    drop(tui);
    drop(launch.keep);
    result
}

fn install_keys(tui: &Rc<Tui>) {
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
            command("app.exit", |tui| tui.app.quit())
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
                palette::show(&tui.dialogs, Vec::new())
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
        bindings(None, &[COMMAND_PALETTE_COMMAND, "help.show"]),
        // `appGlobalBindingCommands` (`app.tsx:117`).
        bindings(Some(GLOBAL_MODE), &["session.list", "session.new", "open.menu"]),
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
    let weak = tui.weak();
    tui.app.on_message(move |_, _: &DataChanged| {
        if let Some(tui) = weak.upgrade() {
            tui.sync();
        }
    });
    let weak = tui.weak();
    tui.app.on_message(move |_, StatusChanged(state)| {
        if let Some(tui) = weak.upgrade() {
            tui.status.set(&tui.page(), state);
        }
    });

    let proxy = tui.app.proxy();
    let pending = Arc::new(AtomicBool::new(false));
    let mut revisions = tui.data.subscribe();
    let clear = pending.clone();
    tui.app
        .on_message(move |_, _: &DataChanged| clear.store(false, Ordering::SeqCst));
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

/// `--continue`: the newest root session of the default location (`app.tsx:689-715`).
fn continue_latest(tui: &Rc<Tui>) {
    let client = tui.data.client().clone();
    let input = SessionListInput {
        limit: Some(1),
        order: Some(SessionListInputOrder::Desc),
        parent_id: Some(None),
        archived: Some(false),
        directory: Some(tui.directory.clone().into()),
        ..SessionListInput::default()
    };
    let weak = tui.weak();
    tui.app.spawn(
        async move {
            client
                .session_list(&input, &RequestOptions::default())
                .await
        },
        move |_, result| {
            let Some(tui) = weak.upgrade() else { return };
            match result {
                Ok(response) => {
                    if let Some(session) = response.data.into_iter().next() {
                        let id = session.id.clone();
                        tui.data.remember(session);
                        tui.navigate(Route::Session { id });
                    }
                }
                Err(error) => tui.toasts.error(error.to_string()),
            }
        },
    );
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
        weak.upgrade()
            .is_some_and(|tui| tui.data.read(|state| !state.sessions().is_empty()))
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
        new_designs: info.experiment("new-designs"),
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
