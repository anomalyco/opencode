//! The split-footer lifecycle (`runtime.lifecycle.ts`, `runtime.ts`, the state half of `footer.ts`).
//!
//! The renderer starts in a footer at the bottom of the main screen and paints at once; the session is resolved
//! behind it. A resumed session clears the terminal and replays its transcript. Closing writes what is queued,
//! leaves split mode, and ends with a newline so the shell continues below the transcript.

use std::time::Instant;

use opencode_local::cli_config::{CliConfig, MiniWorkSpinner, NewLocation, ThemeMode as ConfigMode, Visibility};
use opencode_local::model_pref::ModelPreferences;
use opencode_store::target::{self, Prepared, SessionTarget, TargetError};
use opencode_ui::motion::{Spinner, SpinnerColor};
use opencode_ui::theme::ThemeMode;
use opencode_util::error::{self, Context as _};
use opentui::native::{KittyKeyboard, MouseTracking};
use opentui::split::{Scrollback, SplitFooter};

use crate::footers::Footers;
use crate::prelude::*;
use crate::prompt::queue::{Queue, Submitted, Work};
use crate::prompt::status::{self, mono_shortcut};
use crate::prompt::{Delivery, Hooks, PROMPT_MAX_ROWS, Prompt, RunPrompt};
use crate::replay::{self, Envelope, Incoming, Output, Transcript};
use crate::scrollback::{Flags, Writer};
use crate::settings::{Change, MiniSettings};
use crate::signals::{self, Trace};
use crate::theme::{self, ThemeInput};
use crate::variants::{ModelSelection, Provider};
use crate::{Input, InputError};

/// `FOOTER_HEIGHT`: the footer's rows before the prompt measures itself.
const FOOTER_HEIGHT: u16 = 4;
/// How long the second Ctrl+C or Esc of a two-press gesture may wait.
const TWO_PRESS: Duration = Duration::from_secs(5);
/// `NOTICE_DURATION`.
const NOTICE: Duration = Duration::from_secs(3);
/// `SHELL_OUTPUT_GRACE_MS`: how long a shell turn waits after `session.shell` answers for its
/// `session.shell.ended` event.
const SHELL_OUTPUT_GRACE: Duration = Duration::from_millis(1500);

pub fn run(input: Input) -> error::Result<()> {
    let settings = MiniSettings::resolve(input.config.mini.as_ref());
    // The footer keeps the terminal's background, as the TS renderer's transparent one does.
    let mut options = AppOptions {
        theme: Theme { background: Color::TRANSPARENT, ..Theme::dark() },
        exit_on_ctrl_c: false,
        light_theme: None,
        palette_size: 256,
        ..AppOptions::default()
    };
    // `applyHeight` below sizes the footer to the composer before the first frame.
    options.host.split_footer = Some(FOOTER_HEIGHT);
    options.host.terminal.mouse = MouseTracking::Off;
    if settings.mono {
        options.host.terminal.kitty_keyboard = KittyKeyboard::OFF;
    } else if cfg!(windows) {
        // As `runtime.lifecycle.ts`: `{ events: platform === "win32" }`, the default flags plus event types.
        options.host.terminal.kitty_keyboard = options.host.terminal.kitty_keyboard | KittyKeyboard::EVENT_TYPES;
    }
    let app = App::new(options)?;
    let footer = SplitFooter::of(app.session()).context("mini runs in a split footer")?;
    let theme_input = ThemeInput {
        name: input.config.theme.as_ref().and_then(|theme| theme.name.clone()),
        mode: input.config.theme.as_ref().and_then(|theme| theme.mode).and_then(|mode| match mode {
            ConfigMode::Light => Some(ThemeMode::Light),
            ConfigMode::Dark => Some(ThemeMode::Dark),
            ConfigMode::System => None,
        }),
        palette: app.palette(),
        directories: input.theme_directories.clone(),
        mono: settings.mono,
    };
    let theme = theme::resolve(&theme_input);
    // The transcript always starts one row below the terminal's earlier output.
    let mut writer = Writer::new(footer.clone(), Scrollback::new(&app)?, theme.clone(), settings.mono, true);
    writer.set_shell_output(settings.shell_output == Visibility::Show);
    writer.set_image_preview(input.config.session.as_ref().and_then(|session| session.image_preview).unwrap_or(false));
    let prompt = Prompt::new(&app, &theme, settings.mono, &input.config);
    let footers = Footers::new(&app, &prompt, &theme, settings.mono);
    let status = Text::new(&app, "").wrap(WrapMode::None).truncate(true).height(1).shrink(0.0);
    status.grow(1.0).basis(Length::Auto).min_width(0);
    // The work spinner's cell and its gap, shown while a turn runs (`mini-work-spinner`).
    let spinner_slot = View::new(&app).width(2).height(1).shrink(0.0).visible(false);
    let status_row =
        View::new(&app).direction(FlexDirection::Row).height(1).shrink(0.0).child(&spinner_slot).child(&status);
    app.root()
        .direction(FlexDirection::Column)
        .child(footers.root())
        .child(prompt.root())
        .child(prompt.menu_root())
        .child(&status_row);
    let mini = Rc::new(Mini {
        app: app.clone(),
        client: input.client.clone(),
        footer,
        writer: RefCell::new(writer),
        transcript: RefCell::new(None),
        footers,
        session: RefCell::new(None),
        prompt,
        status,
        status_row,
        spinner_slot,
        spinner: RefCell::new(None),
        animations: input.config.animations != Some(false),
        providers: RefCell::new(None),
        variants: RefCell::new(Vec::new()),
        catalog_refresh: Cell::new(None),
        preferences: ModelPreferences::new(&input.paths.state),
        config_store: CliConfig::new(&input.paths),
        queue: RefCell::new(Queue::default()),
        state: RefCell::new(State::default()),
        shell: RefCell::new(None),
        theme_input,
        settings: Cell::new(settings),
        input: Meta {
            directory: input.directory.clone(),
            new_location: input
                .config
                .session
                .as_ref()
                .and_then(|session| session.new_location)
                .unwrap_or(NewLocation::Launch),
            home: input.home.clone(),
            version: input.version.clone(),
            replay: input.replay,
            replay_limit: input.replay_limit,
            trace: input.trace.clone(),
            environment: input.target.environment.clone(),
        },
        initial: RefCell::new(input.initial_input.clone()),
        cli_variant: RefCell::new(input.target.model.as_ref().and_then(|model| model.variant.clone())),
        waiting: RefCell::new(Vec::new()),
        stream: RefCell::new(None),
        settle_after: RefCell::new(None),
        connected: RefCell::new(tokio::sync::watch::channel(false).1),
        resize: Cell::new(None),
        resize_queued: Cell::new(false),
        height_pending: Cell::new(false),
        size: Cell::new(SplitFooter::of(app.session()).map_or((0, 0), |footer| footer.terminal_size())),
        exit_splash: Cell::new(false),
        failure: RefCell::new(None),
    });
    mini.set_title(None);
    mini.paint_status();
    mini.apply_height();
    mini.wire();
    // The entry header, before the session resolves (`queueSplash("entry")`).
    if settings.splash == Visibility::Show
        && let Err(error) = mini.write_entry()
    {
        log::warn!("mini could not write the entry splash: {error}");
    }
    mini.resolve(input.target, input.start);
    mini.prompt.focus();
    let _theme_signal = signals::on_sigusr2(&app);
    app.on_message({
        let mini = mini.clone();
        move |_, _: &signals::ThemeReload| mini.refresh_theme()
    });
    app.on_message({
        let mini = mini.clone();
        move |cx, line: &crate::stderr::Line| {
            if mini.footer.is_split() {
                mini.write(cx, Commit::system(line.0.clone()));
            }
        }
    });
    let stderr = crate::stderr::Capture::start(&app)
        .inspect_err(|error| log::warn!("mini could not capture stderr: {error}"))
        .ok();
    let result = app.run();
    if let Some(stderr) = stderr {
        stderr.stop();
    }
    mini.stop();
    if !mini.exit_splash.get() {
        println!();
    }
    result?;
    if let Some(failure) = mini.failure.borrow_mut().take() {
        return Err(failure);
    }
    Ok(())
}

/// What the command resolved, kept for the session's lifetime.
struct Meta {
    directory: String,
    new_location: NewLocation,
    home: std::path::PathBuf,
    version: String,
    replay: bool,
    replay_limit: Option<u32>,
    trace: Option<Trace>,
    /// The environment uploaded to each session this client opens or starts.
    environment: Option<indexmap::IndexMap<String, String>>,
}

/// The session mini talks to, once resolved.
#[derive(Clone, Debug)]
struct Session {
    id: String,
    title: Option<String>,
    agent: Option<String>,
    /// `{ providerID, id, variant }` for `session.switchModel`.
    model: Option<Value>,
    /// The session's location (`state.location.directory`).
    directory: String,
}

/// The footer's state (`FooterState`).
#[derive(Debug, Default)]
struct State {
    running: bool,
    status: String,
    notice: String,
    notice_timer: Option<TimerId>,
    /// The model's ID, provider, and variant; M.4 names them from the provider catalog.
    model: Option<(String, Option<String>, Option<String>)>,
    usage: Option<replay::Usage>,
    agent: String,
    exit: u8,
    interrupt: u8,
    exit_timer: Option<TimerId>,
    interrupt_timer: Option<TimerId>,
    closed: bool,
    /// A prompt turn is in flight (`state.wait`).
    turn: bool,
}

/// The `!` shell turn in flight (`ShellWait`). It holds no server drain, so the two-press gesture aborts its
/// request instead of interrupting the session.
struct ShellWait {
    message_id: String,
    /// The shell's ID, from the `session.shell.started` event of this message.
    shell_id: Option<String>,
    ended: bool,
    task: Option<opentui::app::TaskHandle>,
    /// `session.shell` answered; the turn waits for `session.shell.ended` until this timer fires.
    grace: Option<TimerId>,
}

struct Mini {
    app: App,
    client: Client,
    footer: SplitFooter,
    writer: RefCell<Writer>,
    transcript: RefCell<Option<Transcript>>,
    footers: Footers,
    session: RefCell<Option<Session>>,
    prompt: Prompt,
    status: Text,
    status_row: View,
    spinner_slot: View,
    /// The running work spinner.
    spinner: RefCell<Option<WorkSpinner>>,
    animations: bool,
    /// The provider catalog (`state.providers`), `None` until it loads.
    providers: RefCell<Option<Vec<Provider>>>,
    /// The current model's variants (`state.variants`).
    variants: RefCell<Vec<String>>,
    /// A catalog refresh in flight, and whether another follows it (`requestCatalogRefresh`).
    catalog_refresh: Cell<Option<bool>>,
    preferences: ModelPreferences,
    config_store: CliConfig,
    queue: RefCell<Queue>,
    state: RefCell<State>,
    shell: RefCell<Option<ShellWait>>,
    theme_input: ThemeInput,
    settings: Cell<MiniSettings>,
    input: Meta,
    /// The piped stdin and `--prompt`, sent once the session and the model catalog are ready.
    initial: RefCell<Option<String>>,
    /// The variant of `--model provider/model#variant`, which wins over the catalog when the first session's models
    /// load (`ctx.variant`).
    cli_variant: RefCell<Option<String>>,
    /// Prompts submitted before the session was ready.
    waiting: RefCell<Vec<RunPrompt>>,
    stream: RefCell<Option<tokio::task::JoinHandle<()>>>,
    /// A settle that waits for the follow-up prompts to be admitted (`await admissions`).
    settle_after: RefCell<Option<(String, std::time::Instant)>>,
    /// Whether the stream is connected, for a session wait that retries (`waitUntilConnected`).
    connected: RefCell<tokio::sync::watch::Receiver<bool>>,
    resize: Cell<Option<TimerId>>,
    /// A resize came while a resize replay ran.
    resize_queued: Cell<bool>,
    /// A footer height waits for the next frame.
    height_pending: Cell<bool>,
    size: Cell<(u16, u16)>,
    exit_splash: Cell<bool>,
    failure: RefCell<Option<error::Error>>,
}

/// The running work spinner and what it was built for: the color, the motion, and mono, and when the work started.
struct WorkSpinner {
    spinner: Spinner,
    color: Color,
    motion: MiniWorkSpinner,
    mono: bool,
    started: Instant,
}

impl Mini {
    fn wire(self: &Rc<Self>) {
        let mini = self.clone();
        self.app.on_message(move |cx, envelope: &Envelope| {
            if let Some(incoming) = envelope.take() {
                mini.incoming(cx, incoming);
            }
        });
        let with = |run: fn(&Rc<Mini>)| bind!(self, |mini| run(&mini));
        self.prompt.set_hooks(Hooks {
            submit: Some(Box::new(bind!(self, |mini, prompt| mini.submit(prompt)))),
            exit_request: Some(Box::new(with(|mini| {
                let mini = mini.clone();
                mini.app.clone().defer(move |cx| mini.request_exit(cx));
            }))),
            exit: Some(Box::new(with(|mini| {
                let mini = mini.clone();
                mini.app.clone().defer(move |cx| mini.close(cx));
            }))),
            interrupt: Some(Box::new(bind!(self, |mini| mini.request_interrupt()))),
            input_clear: Some(Box::new(with(|mini| mini.input_clear()))),
            status: Some(Box::new(bind!(self, |mini, text| mini.set_notice(text)))),
            layout: Some(Box::new(with(|mini| {
                mini.schedule_height();
                mini.paint_status();
            }))),
            clear_screen: Some(Box::new(with(|mini| mini.clear_screen()))),
            settings: Some(Box::new(with(|mini| mini.footers.open_settings()))),
        });
        self.footers.set_hooks(crate::footers::Hooks {
            layout: Some(Box::new(with(|mini| {
                mini.schedule_height();
                mini.paint_status();
            }))),
            status: Some(Box::new(bind!(self, |mini, text| mini.set_notice(text)))),
            blocker: Some(Box::new(bind!(self, |mini, text| mini.patch(|state| state.status = text.to_owned())))),
            summary: Some(Box::new(bind!(self, |mini| mini.summary()))),
            agent: Some(Box::new(bind!(self, |mini, id| mini.select_agent(id)))),
            clear_screen: Some(Box::new(with(|mini| mini.clear_screen()))),
            exit: Some(Box::new(with(|mini| {
                let mini = mini.clone();
                mini.app.clone().defer(move |cx| mini.close(cx));
            }))),
            models: Some(Box::new(bind!(self, |mini| mini.models()))),
            model: Some(Box::new(bind!(self, |mini, model| mini.select_model(model)))),
            variant: Some(Box::new(bind!(self, |mini, variant| mini.select_variant(variant)))),
            cycle_variant: Some(Box::new(with(|mini| mini.cycle_variant()))),
            settings: Some(Box::new(bind!(self, |mini| mini.settings.get(), else MiniSettings::resolve(None)))),
            setting: Some(Box::new(bind!(self, |mini, change, done| mini.change_setting(change, done)))),
        });
        self.prompt.install();
        let mini = self.clone();
        self.app.on_resize(move |cx, _, _| mini.resized(cx));
    }

    /// Resolves the session behind the first frame (`ensureSession`).
    fn resolve(self: &Rc<Self>, target: target::TargetInput, start: std::time::Instant) {
        if signals::show_timing() {
            let mini = self.clone();
            self.app.set_timeout(Duration::ZERO, move |cx| {
                let elapsed = start.elapsed().as_millis();
                mini.append(cx, Commit::system(format!("startup {elapsed}ms")));
            });
        }
        let client = self.client.clone();
        let agent = target.agent.clone();
        let mini = self.clone();
        self.app.spawn(
            async move {
                target::resolve_session_target(&client, target, |next| async move {
                    Ok(Prepared { model: next.model, agent: agent.or(next.agent) })
                })
                .await
            },
            move |cx, result| match result {
                Ok(target) => mini.opened(cx, target),
                Err(TargetError::SessionNotFound) => mini.fail(cx, InputError("Session not found".into()).into()),
                Err(error) => mini.fail(cx, error::Error::new(error)),
            },
        );
    }

    fn fail(&self, cx: &mut Cx<'_>, error: error::Error) {
        *self.failure.borrow_mut() = Some(error);
        self.close(cx);
    }

    fn opened(self: &Rc<Self>, cx: &mut Cx<'_>, target: SessionTarget) {
        if self.state.borrow().closed {
            return;
        }
        let variant = opened_variant(&target);
        let session = Session {
            id: target.session.id.0.clone(),
            title: target.session.title.clone(),
            agent: target.agent.clone(),
            directory: target.location.directory.0.clone(),
            model: target.model.as_ref().map(|model| {
                let mut value = json!({ "providerID": model.provider_id.0, "id": model.id });
                if let Some(variant) = &variant {
                    value["variant"] = json!(variant);
                }
                value
            }),
        };
        self.trace("session.open", json!({ "sessionID": session.id, "resume": target.resume }));
        self.set_title(session.title.as_deref());
        let model =
            target.model.as_ref().map(|model| (model.id.clone(), Some(model.provider_id.0.clone()), variant.clone()));
        self.patch(|state| {
            state.agent = session.agent.clone().unwrap_or_default();
            state.model = model;
            state.usage = None;
        });
        let mut transcript = Transcript::new(
            &session.id,
            self.settings.get().thinking == Visibility::Show,
            self.settings.get().tools == Visibility::Show,
            self.input.replay,
            self.input.replay_limit,
        );
        transcript.directory = Some(session.directory.clone());
        *self.transcript.borrow_mut() = Some(transcript);
        *self.session.borrow_mut() = Some(session.clone());
        self.prompt.set_agent(session.agent.as_deref().unwrap_or_default());
        self.prompt.open(&self.client, &session.id, &session.directory, target.resume);
        self.footers.open(
            &self.client,
            &session.id,
            &session.directory,
            self.settings.get().thinking == Visibility::Show,
        );
        if target.resume {
            self.reset_for_replay(cx);
        }
        if target.model.is_none() {
            self.load_default_model(&session.directory);
        }
        let cli_variant = self.cli_variant.take();
        self.load_models(&session.directory, cli_variant, variant);
        let proxy = self.app.proxy();
        let limit = self.input.replay_limit.unwrap_or(replay::DEFAULT_REPLAY_LIMIT);
        let (connected, receiver) = tokio::sync::watch::channel(false);
        *self.connected.borrow_mut() = receiver;
        let task = self.app.runtime().spawn(replay::connect(
            self.client.clone(),
            session.id,
            session.directory,
            limit,
            proxy,
            connected,
        ));
        *self.stream.borrow_mut() = Some(task);
    }

    /// `loadCurrentModel`: the provider catalog, then the current model's variants and the variant to use. The
    /// `--model` flag's variant wins, even over a catalog that does not list it. Prompts wait for the catalog
    /// (`await modelTask`).
    fn load_models(self: &Rc<Self>, directory: &str, cli_variant: Option<String>, session_variant: Option<String>) {
        let client = self.client.clone();
        let directory = directory.to_owned();
        let mini = self.clone();
        self.app.spawn(async move { crate::variants::load(&client, &directory).await }, move |cx, result| {
            let providers = result.unwrap_or_else(|error| {
                log::warn!("mini could not load the providers: {error}");
                Vec::new()
            });
            *mini.providers.borrow_mut() = Some(providers);
            if let Some(model) = mini.selection() {
                let variants = crate::variants::variants_for(mini.providers().as_slice(), &model);
                let saved = crate::variants::saved_variant(&mini.preferences, &model);
                let variant = crate::variants::resolve_variant(
                    cli_variant.as_deref(),
                    session_variant.as_deref(),
                    saved.as_deref(),
                    &variants,
                );
                *mini.variants.borrow_mut() = variants;
                mini.set_variant(variant);
            }
            mini.footers.models_changed();
            mini.paint_status();
            if mini.transcript.borrow().as_ref().is_some_and(|transcript| transcript.connected) {
                mini.send_waiting(cx);
            }
        });
    }

    fn providers(&self) -> Vec<Provider> {
        self.providers.borrow().clone().unwrap_or_default()
    }

    /// The model prompts use (`state.model ?? state.defaultModel`).
    fn selection(&self) -> Option<ModelSelection> {
        let state = self.state.borrow();
        let (model, provider, _) = state.model.as_ref()?;
        Some(ModelSelection { provider_id: provider.clone()?, model_id: model.clone() })
    }

    fn models(&self) -> crate::footers::Models {
        crate::footers::Models {
            providers: self.providers.borrow().clone(),
            current: self.selection(),
            variants: self.variants.borrow().clone(),
            variant: self.state.borrow().model.as_ref().and_then(|model| model.2.clone()),
        }
    }

    /// The variant of the current model, in the status row and in the session's model for the next prompt.
    fn set_variant(&self, variant: Option<String>) {
        let Some(model) = self.selection() else { return };
        self.patch(|state| {
            if let Some(current) = state.model.as_mut() {
                current.2 = variant.clone();
            }
        });
        if let Some(session) = self.session.borrow_mut().as_mut() {
            let mut value = json!({ "providerID": model.provider_id, "id": model.model_id });
            if let Some(variant) = &variant {
                value["variant"] = json!(variant);
            }
            session.model = Some(value);
        }
    }

    /// `onModelSelect`: the next prompt uses `model`, with its saved variant.
    fn select_model(self: &Rc<Self>, model: ModelSelection) {
        if self.selection().as_ref() == Some(&model)
            && self.session.borrow().as_ref().is_some_and(|s| s.model.is_some())
        {
            return;
        }
        let variants = crate::variants::variants_for(&self.providers(), &model);
        let saved = crate::variants::saved_variant(&self.preferences, &model);
        let variant = crate::variants::resolve_variant(None, None, saved.as_deref(), &variants);
        *self.variants.borrow_mut() = variants;
        let id = model.model_id.clone();
        self.patch(|state| state.model = Some((model.model_id, Some(model.provider_id), None)));
        self.set_variant(variant);
        self.footers.models_changed();
        self.set_notice(&format!("model {id}"));
    }

    /// `onVariantSelect`.
    fn select_variant(self: &Rc<Self>, variant: Option<String>) {
        let Some(model) = self.selection().filter(|_| !self.variants.borrow().is_empty()) else {
            self.set_notice("no variants available");
            return;
        };
        if let Some(name) = variant.as_ref().filter(|name| !self.variants.borrow().contains(name)) {
            self.set_notice(&format!("variant {name} unavailable"));
            return;
        }
        crate::variants::save_variant(&self.preferences, &model, variant.as_deref());
        self.set_notice(
            &variant.as_ref().map_or_else(|| "variant default".to_owned(), |name| format!("variant {name}")),
        );
        self.set_variant(variant);
        self.footers.models_changed();
    }

    /// `onCycleVariant`: the next variant, then the default, saved for the model.
    fn cycle_variant(self: &Rc<Self>) {
        let Some(model) = self.selection().filter(|_| !self.variants.borrow().is_empty()) else {
            self.set_notice("no variants available");
            return;
        };
        let current = self.state.borrow().model.as_ref().and_then(|model| model.2.clone());
        let variant = crate::variants::cycle_variant(current.as_deref(), &self.variants.borrow());
        crate::variants::save_variant(&self.preferences, &model, variant.as_deref());
        self.set_notice(
            &variant.as_ref().map_or_else(|| "variant default".to_owned(), |name| format!("variant {name}")),
        );
        self.set_variant(variant);
        self.footers.models_changed();
    }

    /// `handleMiniSettingChange`: saves the change to `cli.json` off the UI thread, then applies it.
    fn change_setting(self: &Rc<Self>, change: Change, done: Box<dyn FnOnce()>) {
        let store = self.config_store.clone();
        let mini = self.clone();
        self.app.spawn(
            async move {
                tokio::task::spawn_blocking(move || store.update(|info| crate::settings::write_change(info, change)))
                    .await
                    .map_err(|error| error.to_string())
                    .and_then(|result| result.map_err(|error| error.to_string()))
            },
            move |_, result| {
                match result {
                    Ok(_) => {
                        mini.apply_settings(mini.settings.get().apply(change));
                        mini.set_notice("settings updated");
                    }
                    Err(error) => {
                        log::warn!("mini could not save settings: {error}");
                        mini.set_notice("failed to save settings");
                    }
                }
                done();
            },
        );
    }

    /// Takes new settings: the transcript, the writer, the theme, and the status row follow.
    fn apply_settings(self: &Rc<Self>, settings: MiniSettings) {
        let previous = self.settings.replace(settings);
        if let Some(transcript) = self.transcript.borrow_mut().as_mut() {
            transcript.thinking = settings.thinking == Visibility::Show;
            transcript.tools = settings.tools == Visibility::Show;
        }
        self.footers.set_thinking(settings.thinking == Visibility::Show);
        let mut writer = self.writer.borrow_mut();
        writer.set_shell_output(settings.shell_output == Visibility::Show);
        if previous.mono != settings.mono {
            if let Err(error) = writer.set_mono(settings.mono) {
                log::warn!("mini could not switch mono: {error}");
            }
            let input = ThemeInput { mono: settings.mono, ..self.theme_input.clone() };
            writer.set_theme(theme::resolve(&input));
        }
        drop(writer);
        self.paint_status();
    }

    /// The work spinner's cell (`OneCellSpinner` in `mini-work-spinner`): recolored in place, built again when
    /// its motion or mono changes, at the age of the work (`age`), and removed while idle.
    fn paint_spinner(&self, busy: bool, color: Color) {
        let settings = self.settings.get();
        let mut current = self.spinner.borrow_mut();
        if !busy {
            if let Some(work) = current.take() {
                work.spinner.detach();
            }
            self.spinner_slot.visible(false);
            return;
        }
        let motion = if settings.mono {
            opencode_ui::motion::seed_mono()
        } else {
            opencode_ui::motion::work_spinner(settings.work_spinner.as_str())
                .unwrap_or_else(opencode_ui::motion::seed_mono)
        };
        // `glow={!mono}`: mono draws every frame in the plain color.
        let paint = if settings.mono {
            SpinnerColor::Solid(color)
        } else {
            opencode_ui::motion::one_cell_color(&motion, color)
        };
        if let Some(work) = current.as_mut()
            && (work.motion, work.mono) == (settings.work_spinner, settings.mono)
        {
            if work.color != color {
                work.spinner.set_color(paint);
                work.color = color;
            }
            return;
        }
        let started = match current.take() {
            Some(work) => {
                work.spinner.detach();
                work.started
            }
            None => self.app.now(),
        };
        let spinner = Spinner::one_cell(&self.app, &motion, color)
            .age(self.app.now().saturating_duration_since(started))
            .animations(self.animations)
            .color(paint);
        let spinner = if settings.mono { spinner.still("*") } else { spinner };
        self.spinner_slot.add(&spinner);
        self.spinner_slot.visible(true);
        *current = Some(WorkSpinner { spinner, color, motion: settings.work_spinner, mono: settings.mono, started });
    }

    /// `loadDefaultModel`: the label of the model a session without one uses.
    fn load_default_model(self: &Rc<Self>, directory: &str) {
        let client = self.client.clone();
        let directory = directory.to_owned();
        let mini = self.clone();
        self.app.spawn(async move { replay::default_model(&client, &directory).await }, move |_, model| {
            let Some((provider_id, model_id)) = model else { return };
            // A model chosen meanwhile wins.
            if mini.state.borrow().model.is_some() {
                return;
            }
            mini.patch(|state| state.model = Some((model_id.clone(), Some(provider_id.clone()), None)));
            // Without the catalog yet, `load_models` resolves the variants once it arrives.
            if mini.providers.borrow().is_none() {
                return;
            }
            let model = ModelSelection { provider_id, model_id };
            let variants = crate::variants::variants_for(&mini.providers(), &model);
            let saved = crate::variants::saved_variant(&mini.preferences, &model);
            let variant = crate::variants::resolve_variant(None, None, saved.as_deref(), &variants);
            *mini.variants.borrow_mut() = variants;
            // The session switches to the default model only for a variant (`if (state.activeVariant)`).
            if variant.is_some() {
                mini.set_variant(variant);
            }
            mini.footers.models_changed();
            mini.paint_status();
        });
    }

    /// `resetForReplay`: clears the terminal and its scrollback, then writes the entry header the transcript
    /// starts under.
    fn reset_for_replay(&self, cx: &mut Cx<'_>) {
        let result = {
            let mut writer = self.writer.borrow_mut();
            writer.complete(false).and_then(|()| {
                writer.reset(true);
                self.footer.reset_for_replay(true)
            })
        };
        if let Err(error) = result.and_then(|()| self.write_entry()) {
            cx.fail(error);
        }
    }

    /// `entrySplash`: the header the transcript starts under.
    fn write_entry(&self) -> Result<()> {
        let writer = self.writer.borrow();
        let width = self.footer.renderer_size().0;
        let directory = self
            .session
            .borrow()
            .as_ref()
            .map_or_else(|| self.input.directory.clone(), |session| session.directory.clone());
        let detail = directory_label(&directory, &self.input.home);
        let header = crate::splash::entry(
            writer.app(),
            u32::from(width),
            &self.input.version,
            &detail,
            &writer.theme().splash,
            writer.mono(),
        );
        writer.write_widget(&header, Flags { start_on_new_line: true, trailing_newline: false })
    }

    fn incoming(self: &Rc<Self>, cx: &mut Cx<'_>, mut incoming: Incoming) {
        if self.state.borrow().closed {
            return;
        }
        let mut hydrated = None;
        let catalog = match &incoming {
            Incoming::Event(event) => self.catalog_event(event),
            Incoming::Hydrated { .. } => true,
            Incoming::Disconnected(_) => false,
        };
        // The requests apply before the events that followed the subscription, and before the status names the request
        // shown.
        if let Incoming::Hydrated { session, requests, .. } = &mut incoming
            && self.transcript.borrow().as_ref().is_some_and(|transcript| &transcript.session_id == session)
        {
            self.footers.hydrated(std::mem::take(requests));
        }
        let output = {
            let mut transcript = self.transcript.borrow_mut();
            let Some(transcript) = transcript.as_mut() else { return };
            match incoming {
                // A hydration of a session that was replaced meanwhile (`current(attempt)`).
                Incoming::Hydrated { session, .. } if session != transcript.session_id => return,
                Incoming::Hydrated { messages, active, inbox, .. } => {
                    let running = active.contains(&transcript.session_id);
                    self.trace("recv.hydrate", json!({ "messages": messages.len(), "active": running }));
                    let reconnect = !transcript.initial;
                    transcript.inbox(&inbox);
                    let output = self.blocked(transcript.hydrate(&messages, running));
                    hydrated = Some((messages, active, inbox, reconnect));
                    output
                }
                Incoming::Event(event) => {
                    // The server sends every session's events; the trace keeps only this session's, as TS does.
                    if self.input.trace.is_some() {
                        let value = serde_json::to_value(&event).unwrap_or_default();
                        if own_event(&value, &transcript.session_id) {
                            self.trace("recv.event", value);
                        }
                    }
                    transcript.event(&event)
                }
                Incoming::Disconnected(error) => {
                    self.trace("recv.reconnect", json!({ "error": error }));
                    transcript.disconnected();
                    Output {
                        patch: Some(replay::Patch {
                            running: Some(true),
                            status: Some("reconnecting".into()),
                            usage: None,
                        }),
                        ..Output::default()
                    }
                }
            }
        };
        let connected =
            output.patch.is_some() && self.transcript.borrow().as_ref().is_some_and(|transcript| transcript.connected);
        let relist = output.relist;
        self.output(cx, output);
        let session = self.transcript.borrow().as_ref().map(|transcript| transcript.session_id.clone());
        if let (Some(ticket), Some(session)) = (relist, session) {
            self.relist(session, ticket);
        }
        if let Some((messages, active, inbox, reconnect)) = hydrated {
            self.queued(&inbox);
            self.footers.subagent_hydrate(&messages, &active, reconnect);
            // A resize that came during a relist the drop abandoned replays after the reconnect's list, and so do
            // events an overflow dropped, which the reconnect's list prints only in part.
            let lost = self.transcript.borrow().as_ref().is_some_and(Transcript::lost);
            if self.resize_queued.take() || lost {
                self.replay_on_resize(cx);
            }
        }
        if connected {
            self.send_waiting(cx);
        }
        if catalog {
            self.refresh_catalog();
        }
    }

    /// `catalogEvents` of this session's location. On a cold Location the first reads may be empty; these events
    /// say the catalog changed.
    fn catalog_event(&self, event: &V2Event) -> bool {
        const TYPES: [&str; 8] = [
            "provider.updated",
            "model.updated",
            "integration.updated",
            "credential.switched",
            "agent.updated",
            "command.updated",
            "skill.updated",
            "reference.updated",
        ];
        if !TYPES.contains(&event.tag()) {
            return false;
        }
        let value = serde_json::to_value(event).unwrap_or_default();
        let Some(directory) = value["location"]["directory"].as_str() else { return true };
        self.session.borrow().as_ref().is_none_or(|session| session.directory == directory)
    }

    /// `requestCatalogRefresh`: reads the agents, references, commands, and providers again, then the default
    /// model when none is chosen. A request while one runs queues one more.
    fn refresh_catalog(self: &Rc<Self>) {
        if self.catalog_refresh.get().is_some() {
            self.catalog_refresh.set(Some(true));
            return;
        }
        let Some(directory) = self.session.borrow().as_ref().map(|session| session.directory.clone()) else { return };
        self.catalog_refresh.set(Some(false));
        let client = self.client.clone();
        let mini = self.clone();
        let read = directory.clone();
        self.app.spawn(
            async move {
                futures_util::future::join(
                    crate::prompt::api::refresh_catalog(&client, &read),
                    crate::variants::load(&client, &read),
                )
                .await
            },
            move |_, (catalog, providers)| {
                let queued = mini.catalog_refresh.take() == Some(true);
                if mini.state.borrow().closed
                    || mini.session.borrow().as_ref().is_none_or(|session| session.directory != directory)
                {
                    return;
                }
                if let Some(catalog) = catalog {
                    mini.prompt.set_catalog(catalog);
                }
                if let Ok(providers) = providers {
                    *mini.providers.borrow_mut() = Some(providers);
                    if let Some(model) = mini.selection() {
                        // `applyModelInfo`: the variant stays while the model still has it.
                        let variants = crate::variants::variants_for(&mini.providers(), &model);
                        let current = mini.state.borrow().model.as_ref().and_then(|model| model.2.clone());
                        *mini.variants.borrow_mut() = variants;
                        mini.set_variant(current.filter(|variant| mini.variants.borrow().contains(variant)));
                    }
                }
                mini.footers.models_changed();
                mini.paint_status();
                if mini.state.borrow().model.is_none() {
                    mini.load_default_model(&directory);
                }
                if queued {
                    mini.refresh_catalog();
                }
            },
        );
    }

    /// A hydration's idle status names the request shown (`blockerStatus`).
    fn blocked(&self, mut output: Output) -> Output {
        if let Some(patch) = output.patch.as_mut().filter(|patch| patch.running == Some(false)) {
            patch.status = Some(self.footers.blocker_status().to_owned());
        }
        output
    }

    /// The pending prompts a hydration listed (`syncPending`).
    fn queued(self: &Rc<Self>, inbox: &[opencode_api::generated::SessionInboxUser]) {
        self.prompt.set_queued(inbox);
        self.footers.queue_changed();
        self.schedule_height();
        self.paint_status();
    }

    /// Writes a transcript output: footer events, commits, then the status.
    fn output(self: &Rc<Self>, cx: &mut Cx<'_>, output: Output) {
        for event in &output.footer {
            if matches!(
                event,
                V2Event::SessionInboxEnqueued(_)
                    | V2Event::SessionInboxDelivered(_)
                    | V2Event::SessionInboxCancelled(_)
                    | V2Event::SessionInboxDeliveryChanged(_)
            ) {
                self.prompt.inbox_event(event);
                self.footers.queue_changed();
                self.paint_status();
            }
            self.footers.event(event);
        }
        for event in &output.subagents {
            self.footers.subagent_event(event);
        }
        if let Some(title) = &output.title {
            if let Some(session) = self.session.borrow_mut().as_mut() {
                session.title = Some(title.clone());
            }
            self.set_title(Some(title));
        }
        for commit in output.commits {
            self.write(cx, commit);
        }
        if let Some(mut patch) = output.patch {
            let idle = patch.running == Some(false);
            // `contextLimit`: the share of the model's context window the step used.
            // A new status replaces the notice (`eventPatch`).
            if patch.status.is_some() {
                self.set_notice("");
            }
            let limit = self.selection().and_then(|model| crate::variants::context_limit(&self.providers(), &model));
            if let (Some(Some(usage)), Some(limit)) = (patch.usage.as_mut(), limit) {
                usage.percent = Some((usage.tokens as f64 / limit as f64 * 100.0 + 0.5).floor() as u64);
            }
            self.patch(|state| {
                if let Some(running) = patch.running {
                    state.running = running || state.turn;
                }
                if let Some(status) = patch.status {
                    state.status = status;
                }
                if let Some(usage) = patch.usage {
                    state.usage = usage;
                }
                if !state.running {
                    state.interrupt = 0;
                }
            });
            self.prompt.set_running(self.state.borrow().running);
            self.footers.set_running(self.state.borrow().running);
            if idle && !self.state.borrow().running {
                self.complete(cx);
            }
        }
        // After the commits, so a shell's output prints before its turn ends.
        for event in &output.footer {
            self.shell_event(cx, event);
        }
    }

    fn write(&self, cx: &mut Cx<'_>, commit: Commit) {
        if let Err(error) = self.writer.borrow_mut().append(commit) {
            log::warn!("mini scrollback write failed: {error}");
            if self.footer.is_split() {
                cx.fail(error);
            }
        }
    }

    /// Appends a row this client prints itself, remembered for a resize replay.
    fn append(&self, cx: &mut Cx<'_>, commit: Commit) {
        if let Some(transcript) = self.transcript.borrow_mut().as_mut() {
            transcript.remember(&commit);
        }
        self.write(cx, commit);
    }

    fn complete(&self, cx: &mut Cx<'_>) {
        if let Err(error) = self.writer.borrow_mut().complete(false) {
            cx.fail(error);
        }
    }

    /// `footer.handlePrompt`: a prompt from the composer goes to the queue, or waits for the session.
    fn submit(self: &Rc<Self>, prompt: RunPrompt) -> bool {
        if self.state.borrow().closed {
            return false;
        }
        if !self.ready() {
            self.waiting.borrow_mut().push(prompt);
            return true;
        }
        self.enqueue(prompt);
        true
    }

    /// The stream is connected and the model catalog loaded once, so a prompt uses the model's variant.
    fn ready(&self) -> bool {
        self.providers.borrow().is_some()
            && self.transcript.borrow().as_ref().is_some_and(|transcript| transcript.connected)
    }

    fn send_waiting(self: &Rc<Self>, _cx: &mut Cx<'_>) {
        if !self.ready() {
            return;
        }
        let initial = self.initial.borrow_mut().take();
        if let Some(text) = initial.filter(|text| !text.trim().is_empty()) {
            self.prompt.push_history(&RunPrompt::text(text.clone()));
            self.enqueue(RunPrompt::text(text));
        }
        let waiting = std::mem::take(&mut *self.waiting.borrow_mut());
        for prompt in waiting {
            self.enqueue(prompt);
        }
    }

    /// `runPromptQueue`'s `submit`.
    fn enqueue(self: &Rc<Self>, prompt: RunPrompt) {
        let submitted = self.queue.borrow_mut().submit(prompt);
        match submitted {
            Submitted::Ignored => {}
            Submitted::Exit => {
                let mini = self.clone();
                self.app.defer(move |cx| mini.close(cx));
            }
            Submitted::Admit => self.admit_next(),
            Submitted::Queued { first } => {
                if first {
                    self.prompt.set_first(false);
                }
                self.pump();
            }
        }
    }

    /// Starts the next queued work when nothing runs (`drain`).
    fn pump(self: &Rc<Self>) {
        let work = self.queue.borrow_mut().pump();
        match work {
            None => {}
            Some(Work::New) => self.new_session(),
            Some(Work::Compact) => self.compact(),
            Some(Work::Run(prompt)) => self.send(prompt),
        }
    }

    /// The active work ended: the next starts, or the footer goes idle (`turn.idle`).
    fn finish(self: &Rc<Self>, cx: &mut Cx<'_>) {
        if self.queue.borrow_mut().done() {
            self.pump();
            return;
        }
        self.patch(|state| state.turn = false);
        self.output(
            cx,
            Output {
                patch: Some(replay::Patch { running: Some(false), status: Some(String::new()), usage: None }),
                ..Output::default()
            },
        );
    }

    /// `turn.send`.
    fn sending(&self, status: &str) {
        self.patch(|state| {
            state.running = true;
            state.turn = true;
            state.status = status.into();
            state.notice.clear();
            state.interrupt = 0;
            state.exit = 0;
        });
        self.prompt.set_running(true);
        self.footers.set_running(true);
    }

    /// `renderPromptError`.
    fn prompt_error(self: &Rc<Self>, cx: &mut Cx<'_>, id: &str, error: String) {
        self.append(cx, Commit { text: error, ..Commit::error("").message(id) });
    }

    /// `run`: a shell command waits for its answer; a server command is admitted; an ordinary prompt switches
    /// the agent and model, is admitted with its delivery (`steer` by default), and waits for the session to
    /// settle, then prints what the live stream missed (`runPromptTurn`).
    fn send(self: &Rc<Self>, prompt: RunPrompt) {
        let Some(session) = self.session.borrow().clone() else { return };
        let client = self.client.clone();
        let mini = self.clone();
        if prompt.shell {
            let id = opencode_api::id::message();
            self.sending("running shell");
            self.trace("send.shell", json!({ "sessionID": session.id, "id": id, "command": prompt.text }));
            let command = prompt.text.clone();
            let message_id = id.clone();
            let task = self.app.spawn(
                {
                    let id = id.clone();
                    async move { crate::prompt::api::shell(&client, &session.id, &id, &command).await }
                },
                move |cx, result| {
                    if let Some(wait) = mini.shell.borrow_mut().as_mut() {
                        wait.task = None;
                    }
                    match result {
                        Ok(()) => mini.shell_answered(cx),
                        Err(error) => {
                            mini.prompt_error(cx, &id, error);
                            mini.end_shell(cx);
                        }
                    }
                },
            );
            *self.shell.borrow_mut() =
                Some(ShellWait { message_id, shell_id: None, ended: false, task: Some(task), grace: None });
            return;
        }
        let id = prompt.message_id.clone().unwrap_or_else(opencode_api::id::message);
        let delivery = prompt.delivery.unwrap_or(Delivery::Steer);
        self.sending("sending prompt");
        let started = std::time::Instant::now();
        match &prompt.command {
            Some(command) => self.trace(
                "send.command",
                json!({ "sessionID": session.id, "messageID": id, "command": command.name, "delivery": delivery.as_str() }),
            ),
            None => self.trace(
                "send.prompt",
                json!({ "sessionID": session.id, "messageID": id, "delivery": delivery.as_str() }),
            ),
        }
        let command = prompt.command.is_some();
        if !command && let Some(transcript) = self.transcript.borrow_mut().as_mut() {
            transcript.begin_wait(&id);
        }
        let text = prompt.text.clone();
        let sent = prompt.clone();
        self.app.spawn(
            {
                let (session, id) = (session.clone(), id.clone());
                async move {
                    if !command {
                        crate::prompt::api::select(
                            &client,
                            &session.id,
                            session.agent.as_deref(),
                            session.model.as_ref(),
                        )
                        .await?;
                    }
                    let prompt = RunPrompt { message_id: Some(id), ..prompt };
                    crate::prompt::api::admit(&client, &session.id, &prompt, delivery).await
                }
            },
            move |cx, result| {
                // The prompts submitted meanwhile follow this one to the server (`admission.resolve`). This runs
                // before `finish`, which may start the next turn.
                mini.queue.borrow_mut().first_admitted();
                mini.admit_next();
                match result {
                    Ok(_) if command => {
                        if mini.settle_admissions(&session.id, started) {
                            return;
                        }
                        mini.turn_summary(cx, started);
                        mini.finish(cx);
                    }
                    Ok(skills) => {
                        mini.pending(&id, delivery, &sent);
                        let output = mini
                            .transcript
                            .borrow_mut()
                            .as_mut()
                            .map(|transcript| transcript.admitted(&id, &text, &sent.inline_files(), &skills))
                            .unwrap_or_default();
                        mini.output(cx, output);
                        mini.settle(&session.id, started);
                    }
                    Err(error) => {
                        if let Some(transcript) = mini.transcript.borrow_mut().as_mut() {
                            transcript.end_wait();
                        }
                        mini.prompt_error(cx, &id, error);
                        if mini.settle_admissions(&session.id, started) {
                            return;
                        }
                        mini.finish(cx);
                    }
                }
            },
        );
    }

    /// Prompts admitted while the turn ran: once every one reached the server, the session settles once more
    /// before the turn ends, so no later work (a queued `/new`) starts while they are admitted (`await admissions`,
    /// `input.settle`). False when there were none.
    fn settle_admissions(self: &Rc<Self>, session: &str, started: std::time::Instant) -> bool {
        if !self.queue.borrow_mut().take_admissions() {
            return false;
        }
        if self.queue.borrow().admissions_idle() {
            self.settle(session, started);
        } else {
            self.settle_after.replace(Some((session.to_owned(), started)));
        }
        true
    }

    /// `session.shell` answered: the turn ends with the shell's `session.shell.ended` event, or after the grace.
    fn shell_answered(self: &Rc<Self>, cx: &mut Cx<'_>) {
        let Some(ended) = self.shell.borrow().as_ref().map(|wait| wait.ended) else { return };
        if ended {
            self.end_shell(cx);
            return;
        }
        let mini = self.clone();
        let timer = self.app.set_timeout(SHELL_OUTPUT_GRACE, move |cx| mini.end_shell(cx));
        if let Some(wait) = self.shell.borrow_mut().as_mut() {
            wait.grace = Some(timer);
        }
    }

    /// The shell turn ended, was aborted, or failed; the next work starts.
    fn end_shell(self: &Rc<Self>, cx: &mut Cx<'_>) {
        let Some(wait) = self.shell.borrow_mut().take() else { return };
        if let Some(timer) = wait.grace {
            self.app.cancel_timer(timer);
        }
        if let Some(task) = wait.task {
            task.abort();
        }
        self.finish(cx);
    }

    /// Follows the shell turn's live events: its shell's ID, then its end.
    fn shell_event(self: &Rc<Self>, cx: &mut Cx<'_>, event: &V2Event) {
        let answered = {
            let mut shell = self.shell.borrow_mut();
            let Some(wait) = shell.as_mut() else { return };
            match event {
                V2Event::SessionShellStarted(started)
                    if replay::message_from_event(started.id.as_str()) == wait.message_id =>
                {
                    wait.shell_id = Some(started.data.shell.id.as_str().to_owned());
                    return;
                }
                V2Event::SessionShellEnded(ended) if wait.shell_id.as_deref() == Some(ended.data.shell.id.as_str()) => {
                    wait.ended = true;
                    wait.grace.is_some()
                }
                _ => return,
            }
        };
        if answered {
            self.end_shell(cx);
        }
    }

    /// Prompts submitted while an ordinary turn runs go to the inbox (`input.admit`) in the order they were
    /// submitted: after the turn's own prompt, one at a time. Once the last is admitted, a settle that waited for
    /// them runs.
    fn admit_next(self: &Rc<Self>) {
        let next = self.queue.borrow_mut().next_admission();
        let Some((prompt, delivery)) = next else {
            if self.queue.borrow().admissions_idle()
                && let Some((session, started)) = self.settle_after.take()
            {
                self.settle(&session, started);
            }
            return;
        };
        let Some(session) = self.session.borrow().clone() else {
            self.queue.borrow_mut().admission_done();
            return;
        };
        let id = prompt.message_id.clone().unwrap_or_default();
        self.trace("send.prompt", json!({ "sessionID": session.id, "messageID": id, "delivery": delivery.as_str() }));
        let client = self.client.clone();
        let mini = self.clone();
        let command = prompt.command.is_some();
        let text = prompt.text.clone();
        let sent = prompt.clone();
        self.app.spawn(
            async move {
                if !command {
                    crate::prompt::api::select(&client, &session.id, session.agent.as_deref(), session.model.as_ref())
                        .await?;
                }
                crate::prompt::api::admit(&client, &session.id, &prompt, delivery).await
            },
            move |cx, result| {
                mini.queue.borrow_mut().admission_done();
                match result {
                    Ok(skills) => {
                        // `session.command` answers without the inbox item; its event adds it.
                        if !command {
                            mini.pending(&id, delivery, &sent);
                        }
                        let output = mini
                            .transcript
                            .borrow_mut()
                            .as_mut()
                            .map(|transcript| transcript.admitted(&id, &text, &sent.inline_files(), &skills))
                            .unwrap_or_default();
                        mini.output(cx, output);
                    }
                    // A failed follow-up does not hold back the ones after it.
                    Err(error) => mini.prompt_error(cx, &id, error),
                }
                mini.admit_next();
            },
        );
    }

    /// `mergePending`: an admitted prompt waits in the pending list until the server delivers it.
    fn pending(&self, id: &str, delivery: Delivery, prompt: &RunPrompt) {
        let promoted = self.transcript.borrow().as_ref().is_some_and(|transcript| transcript.promoted(id));
        if promoted {
            return;
        }
        self.prompt.admitted(id, delivery, prompt);
        self.footers.queue_changed();
        self.paint_status();
    }

    /// `/compact`: `session.compact`.
    fn compact(self: &Rc<Self>) {
        let Some(session) = self.session.borrow().clone() else { return };
        self.sending("compacting session");
        let client = self.client.clone();
        let mini = self.clone();
        self.app.spawn(async move { crate::prompt::api::compact(&client, &session.id).await }, move |cx, result| {
            if let Err(error) = result {
                let id = opencode_api::id::message();
                mini.prompt_error(cx, &id, error);
            }
            mini.finish(cx);
        });
    }

    /// `/new`: a new session at the launch directory, with the current agent and model (`onNewSession`).
    fn new_session(self: &Rc<Self>) {
        let Some(session) = self.session.borrow().clone() else { return };
        self.sending("starting new session");
        let client = self.client.clone();
        let mini = self.clone();
        let model = session.model.as_ref().and_then(|model| {
            Some(opencode_api::generated::ModelRef {
                provider_id: opencode_api::generated::ProviderID(model["providerID"].as_str()?.to_owned()),
                id: model["id"].as_str()?.to_owned(),
                variant: model["variant"].as_str().map(str::to_owned),
            })
        });
        // `newSessionLocation`: `session.new_location: inherit` keeps the current session's location.
        let directory = match self.input.new_location {
            NewLocation::Inherit => session.directory.clone(),
            NewLocation::Launch => self.input.directory.clone(),
        };
        let input = target::TargetInput {
            directory: Some(directory),
            agent: session.agent.clone(),
            model,
            environment: self.input.environment.clone(),
            ..target::TargetInput::default()
        };
        let agent = session.agent.clone();
        self.app.spawn(
            async move {
                target::resolve_session_target(&client, input, |next| async move {
                    Ok(Prepared { model: next.model, agent: agent.or(next.agent) })
                })
                .await
            },
            move |cx, result| {
                match result {
                    Ok(next) => {
                        mini.stop();
                        mini.complete(cx);
                        let id = next.session.id.0.clone();
                        mini.opened(cx, next);
                        mini.prompt.set_first(true);
                        mini.trace("session.new", json!({ "sessionID": id }));
                        mini.write(cx, Commit::system(format!("new session {id}")));
                    }
                    Err(error) => {
                        mini.patch(|state| state.status = "failed to start new session".into());
                        let id = opencode_api::id::message();
                        mini.prompt_error(cx, &id, error.to_string());
                    }
                }
                mini.finish(cx);
            },
        );
    }

    /// `settleSession`: waits until the session is idle, then lists its messages. Prompts admitted meanwhile
    /// settle once more.
    fn settle(self: &Rc<Self>, session: &str, started: std::time::Instant) {
        let client = self.client.clone();
        let session = session.to_owned();
        let limit = self.input.replay_limit.unwrap_or(replay::DEFAULT_REPLAY_LIMIT);
        let mini = self.clone();
        let connected = self.connected.borrow().clone();
        self.app.spawn(
            {
                let session = session.clone();
                async move {
                    replay::wait(&client, &session, connected).await?;
                    replay::messages(&client, &session, limit).await
                }
            },
            move |cx, result| {
                let mut output = Output::default();
                match result {
                    Ok(messages) => {
                        if let Some(transcript) = mini.transcript.borrow_mut().as_mut() {
                            for message in &messages {
                                output.extend(transcript.message(message, true));
                            }
                        }
                    }
                    Err(error) => log::warn!("mini settle failed: {error}"),
                }
                mini.output(cx, output);
                if mini.settle_admissions(&session, started) {
                    return;
                }
                let error = mini.transcript.borrow_mut().as_mut().and_then(Transcript::end_wait);
                if let Some(error) = error {
                    mini.append(cx, error);
                }
                mini.turn_summary(cx, started);
                mini.finish(cx);
            },
        );
    }

    /// `turn.duration`: the agent, model, and time of a finished turn, below its answer.
    fn turn_summary(&self, cx: &mut Cx<'_>, started: std::time::Instant) {
        if self.settings.get().turn_summary == Visibility::Hide {
            return;
        }
        let model = match self.selection() {
            Some(selection) => crate::variants::model_info(&self.providers(), &selection).0,
            None => self.state.borrow().model.as_ref().map_or_else(|| "Default model".into(), |model| model.0.clone()),
        };
        let summary = crate::scrollback::TurnSummary {
            agent: self.agent_label(&self.state.borrow().agent),
            model,
            duration: opencode_ui::locale::duration(started.elapsed().as_millis() as f64),
        };
        let mut commit = Commit::system(format!("{} · {} · {}", summary.agent, summary.model, summary.duration));
        commit.summary = Some(summary);
        self.write(cx, commit);
    }

    /// Two presses within five seconds leave (`handleExit`).
    fn request_exit(self: &Rc<Self>, cx: &mut Cx<'_>) {
        let exit = {
            let mut state = self.state.borrow_mut();
            if state.closed {
                return;
            }
            state.exit += 1;
            state.interrupt = 0;
            state.exit
        };
        if exit >= 2 {
            self.close(cx);
            return;
        }
        let mini = self.clone();
        let timer = self.app.set_timeout(TWO_PRESS, move |_| mini.patch(|state| state.exit = 0));
        if let Some(previous) = self.state.borrow_mut().exit_timer.replace(timer) {
            self.app.cancel_timer(previous);
        }
        self.paint_status();
    }

    /// Two presses of Esc while the session runs interrupt it (`handleInterrupt`).
    fn request_interrupt(self: &Rc<Self>) -> bool {
        let interrupt = {
            let mut state = self.state.borrow_mut();
            if state.closed || !state.running {
                return false;
            }
            state.interrupt += 1;
            state.interrupt
        };
        if interrupt < 2 {
            let mini = self.clone();
            let timer = self.app.set_timeout(TWO_PRESS, move |_| mini.patch(|state| state.interrupt = 0));
            if let Some(previous) = self.state.borrow_mut().interrupt_timer.replace(timer) {
                self.app.cancel_timer(previous);
            }
            self.paint_status();
            return true;
        }
        self.patch(|state| state.interrupt = 0);
        self.set_notice("interrupting");
        // A running shell holds no drain, so `session.interrupt` cannot reach it: its request is aborted instead,
        // and the command on the server keeps its own lifecycle.
        if self.shell.borrow().is_some() {
            let mini = self.clone();
            self.app.defer(move |cx| mini.end_shell(cx));
            return true;
        }
        let Some(session) = self.session.borrow().clone() else { return true };
        if let Some(transcript) = self.transcript.borrow_mut().as_mut() {
            transcript.interrupt_wait();
        }
        self.trace("send.interrupt", json!({ "sessionID": session.id }));
        let client = self.client.clone();
        self.app.spawn(async move { replay::interrupt(&client, &session.id, Some(true)).await }, |_, result| {
            if let Err(error) = result {
                log::warn!("mini interrupt failed: {error}");
            }
        });
        true
    }

    /// `setStatus`: a notice in the status row for three seconds.
    fn set_notice(self: &Rc<Self>, text: &str) {
        let previous = self.state.borrow_mut().notice_timer.take();
        if let Some(previous) = previous {
            self.app.cancel_timer(previous);
        }
        self.patch(|state| state.notice = text.to_owned());
        if text.is_empty() {
            return;
        }
        let timer = self.app.set_timeout(
            NOTICE,
            bind!(self, |mini, _| mini.patch(|state| {
                state.notice.clear();
                state.notice_timer = None;
            })),
        );
        self.state.borrow_mut().notice_timer = Some(timer);
    }

    /// `handleInputClear`: typing disarms the two-press gestures.
    fn input_clear(&self) {
        let timers = {
            let mut state = self.state.borrow_mut();
            if state.interrupt == 0 && state.exit == 0 {
                return;
            }
            state.interrupt = 0;
            state.exit = 0;
            [state.interrupt_timer.take(), state.exit_timer.take()]
        };
        for timer in timers.into_iter().flatten() {
            self.app.cancel_timer(timer);
        }
        self.paint_status();
    }

    /// `app.clear` (`clearScreen`): homes and clears the visible screen, keeps the terminal's scrollback, and
    /// repaints the footer.
    fn clear_screen(&self) {
        if self.state.borrow().closed || !self.footer.is_split() {
            return;
        }
        if let Err(error) = self.footer.reset_for_replay(false) {
            log::warn!("mini could not clear the screen: {error}");
        }
        self.app.request_redraw();
    }

    /// `close`: finish the streaming entry, leave split mode, and quit. The newline follows `app.run()`.
    fn close(&self, cx: &mut Cx<'_>) {
        {
            let mut state = self.state.borrow_mut();
            if state.closed {
                return;
            }
            state.closed = true;
            state.status = "exiting".into();
        }
        self.stop();
        let _ = self.writer.borrow_mut().complete(false);
        let session = self.session.borrow().clone();
        // `showExit`: the session has prompts, earlier or sent now.
        if let Some(session) = session
            && self.settings.get().splash == Visibility::Show
            && self.prompt.shown()
        {
            let writer = self.writer.borrow();
            let title = match session.title.as_deref().filter(|title| !is_fallback_title(title)) {
                Some(title) => Some(title.to_owned()),
                None => self.prompt.first_text().or(session.title.clone()),
            };
            let width = u32::from(self.footer.renderer_size().0);
            let title = crate::splash::title(title.as_deref(), writer.mono());
            let banner =
                crate::splash::exit(writer.app(), width, &title, &session.id, &writer.theme().splash, writer.mono());
            if writer.write_widget(&banner, Flags { start_on_new_line: true, trailing_newline: false }).is_ok() {
                self.exit_splash.set(true);
            }
        }
        if cfg!(target_os = "linux") {
            self.app.set_title("");
        }
        if let Err(error) = self.footer.leave() {
            log::warn!("mini could not leave the split footer: {error}");
        }
        cx.quit();
    }

    fn stop(&self) {
        if let Some(task) = self.stream.borrow_mut().take() {
            task.abort();
        }
    }

    /// A terminal resize: the footer follows at once, the theme and the transcript after 250 ms of quiet.
    fn resized(self: &Rc<Self>, _cx: &mut Cx<'_>) {
        let size = self.footer.terminal_size();
        if size == self.size.replace(size) {
            return;
        }
        self.apply_height();
        self.schedule_replay();
    }

    /// Replays the transcript after 250 ms of quiet, replacing one already scheduled.
    fn schedule_replay(self: &Rc<Self>) {
        if let Some(timer) = self.resize.take() {
            self.app.cancel_timer(timer);
        }
        let mini = self.clone();
        let timer = self.app.set_timeout(replay::RESIZE_DELAY, move |cx| {
            mini.resize.set(None);
            if mini.state.borrow().closed {
                return;
            }
            mini.refresh_theme();
            mini.replay_on_resize(cx);
        });
        self.resize.set(Some(timer));
    }

    /// `replayOnResize`: clear, list the messages again, and write the transcript at the new width.
    fn replay_on_resize(self: &Rc<Self>, _cx: &mut Cx<'_>) {
        let (session, ticket) = {
            let mut transcript = self.transcript.borrow_mut();
            let Some(transcript) = transcript.as_mut() else { return };
            if !self.input.replay || !transcript.connected {
                return;
            }
            // The last size wins: a resize during a replay replays once more after it (`queuedResizeReplay`).
            if transcript.replaying() {
                self.resize_queued.set(true);
                return;
            }
            (transcript.session_id.clone(), transcript.begin_replay())
        };
        self.relist(session, ticket);
    }

    /// Lists `session` again for the resize replay of `ticket`, then clears the terminal and writes the transcript.
    fn relist(self: &Rc<Self>, session: String, ticket: u64) {
        self.trace("replay.resize", json!({ "sessionID": session }));
        let client = self.client.clone();
        let limit = self.input.replay_limit.unwrap_or(replay::DEFAULT_REPLAY_LIMIT);
        let directory = self.session.borrow().as_ref().map(|session| session.directory.clone()).unwrap_or_default();
        let mini = self.clone();
        let read = session.clone();
        let task = async move { replay::hydration(&client, &read, &directory, limit).await };
        self.app.spawn(task, move |cx, result| {
            // Another session opened meanwhile.
            if mini.transcript.borrow().as_ref().is_none_or(|transcript| transcript.session_id != session) {
                mini.resize_queued.set(false);
                return;
            }
            // A drop abandoned this relist, or its events overflowed and a newer read replaced it.
            if mini.transcript.borrow().as_ref().is_some_and(|transcript| !transcript.relisting(ticket)) {
                return;
            }
            let lost = mini.transcript.borrow().as_ref().is_some_and(Transcript::lost);
            let output = match result {
                Ok((messages, active, inbox, requests)) => {
                    mini.reset_for_replay(cx);
                    mini.queued(&inbox);
                    mini.footers.hydrated(requests);
                    let output = mini.transcript.borrow_mut().as_mut().map(|transcript| {
                        transcript.inbox(&inbox);
                        transcript.replayed(&messages, active.contains(&transcript.session_id))
                    });
                    // The dropped events included the children's: they follow as after a reconnect.
                    if lost {
                        mini.footers.subagent_hydrate(&messages, &active, true);
                    }
                    output.map(|output| mini.blocked(output))
                }
                // Nothing was cleared; the events that waited still apply.
                Err(error) => {
                    log::warn!("mini resize replay failed: {error}");
                    mini.transcript.borrow_mut().as_mut().map(Transcript::abort_replay)
                }
            };
            if let Some(output) = output {
                mini.output(cx, output);
            }
            if mini.resize_queued.take() {
                mini.replay_on_resize(cx);
            } else if mini.transcript.borrow().as_ref().is_some_and(Transcript::lost) {
                // A failed read leaves dropped events unshown: try again after a pause.
                mini.schedule_replay();
            }
        });
    }

    /// Re-resolves the theme (SIGUSR2, resize). New entries take it; written rows keep theirs.
    fn refresh_theme(&self) {
        let theme = theme::resolve(&self.theme_input);
        self.prompt.set_theme(&theme);
        self.footers.set_theme(&theme);
        self.writer.borrow_mut().set_theme(theme);
        self.paint_status();
    }

    /// `applyHeight` for the composer: the prompt's rows, padded in a tall terminal, plus the status row unless
    /// the autocomplete menu replaces it.
    fn apply_height(&self) {
        let terminal = self.footer.terminal_size();
        let height = match self.footers.height(terminal) {
            Some(height) => {
                self.status_row.visible(false);
                height
            }
            None => {
                let height = prompt_height(terminal.1, self.prompt.rows(terminal));
                self.status_row.visible(!self.prompt.menu_visible());
                height
            }
        };
        if let Err(error) = self.footer.set_footer_height(height) {
            log::warn!("mini could not set the footer height: {error}");
        }
    }

    /// Applies the composer's height before the next frame, once for all the keys of one read. A split footer
    /// that grows scrolls the transcript up, and shrinking does not bring it back, so a menu that opens and
    /// closes within one paste must not resize the footer.
    fn schedule_height(self: &Rc<Self>) {
        if self.height_pending.replace(true) {
            return;
        }
        self.app.animate(bind!(self, |mini, _, _| {
            mini.height_pending.set(false);
            if !mini.state.borrow().closed {
                mini.apply_height();
            }
            false
        }));
    }

    fn patch(&self, change: impl FnOnce(&mut State)) {
        change(&mut self.state.borrow_mut());
        self.paint_status();
    }

    /// The status row (`statusText` and `statuslineLayout`): the two-press hints or a notice take it over;
    /// otherwise the status, the agent, the model, and the hints that fit.
    fn paint_status(&self) {
        let groups = {
            let state = self.state.borrow();
            self.status_groups(&state)
        };
        let theme = self.writer.borrow().theme().clone();
        let state = self.state.borrow();
        let status = if state.exit > 0 {
            theme.footer.error
        } else if state.interrupt > 0 {
            theme.footer.warning
        } else if state.running || !state.notice.is_empty() || !state.status.trim().is_empty() {
            theme.footer.text
        } else {
            theme.footer.muted
        };
        let agent = self.prompt.agent_color();
        let separator = if self.settings.get().mono { " - " } else { " · " };
        let mut spans: Vec<Span> = Vec::new();
        let mut previous = None;
        let busy = groups.iter().any(|group| group.id == status::Id::Spinner);
        drop(state);
        self.paint_spinner(busy, agent);
        // The spinner draws in its own cell before the text.
        for group in groups.iter().filter(|group| group.id != status::Id::Spinner) {
            if previous.is_some() {
                spans.push(separator.fg(theme.footer.muted));
            }
            for (text, tone) in &group.parts {
                let color = match (group.id, tone) {
                    (_, status::Tone::Agent) => agent,
                    (_, status::Tone::Text) => theme.footer.text,
                    (_, status::Tone::Muted) => theme.footer.muted,
                    (_, status::Tone::Status) => status,
                };
                spans.push(text.clone().fg(color));
            }
            previous = Some(group.id);
        }
        self.status.set_text(spans);
    }

    fn status_groups(&self, state: &State) -> Vec<status::Group> {
        let keymap = self.prompt.keymap();
        let shortcut = |id: &str| {
            keymap.shortcut(id).filter(|key| !key.is_empty()).map(|key| mono_shortcut(&key, self.settings.get().mono))
        };
        let interrupt = shortcut("session.interrupt").map(|key| if key == "escape" { "esc".to_owned() } else { key });
        let busy = state.running;
        let armed = state.interrupt > 0;
        let exiting = state.exit > 0;
        let notice = state.notice.trim();
        let shell = self.prompt.shell();
        let takeover = exiting || (busy && armed) || !notice.is_empty();
        let details = self.settings.get().footer == Visibility::Show && !takeover;
        let width = usize::from(self.footer.terminal_size().0);
        let status_width = width.saturating_sub(if busy { 2 } else { 0 }).max(1);
        let text = if exiting || (busy && armed) {
            let key = if exiting { shortcut("prompt.clear") } else { interrupt.clone() };
            let (verb, action) = if exiting { ("exit", "exit") } else { ("interrupt", "stop") };
            match key {
                None if exiting => "Exit pending".to_owned(),
                None => "Stop pending".to_owned(),
                Some(key) => {
                    let phrases = [
                        format!("Press {key} again to {verb}"),
                        format!("{key} again to {verb}"),
                        format!("{key} again: {action}"),
                        format!("{key} {action}"),
                    ];
                    phrases.iter().find(|text| text.width() <= status_width).unwrap_or(&phrases[3]).clone()
                }
            }
        } else if !notice.is_empty() {
            notice.to_owned()
        } else if !details {
            if shell { "Shell" } else { "" }.to_owned()
        } else if busy {
            if state.status.trim() == "reconnecting" {
                "reconnecting".to_owned()
            } else {
                interrupt.as_ref().map_or_else(|| "Running".to_owned(), |key| format!("{key} stop"))
            }
        } else if !state.status.trim().is_empty() {
            state.status.trim().to_owned()
        } else {
            if shell { "Shell" } else { "" }.to_owned()
        };
        // The status row names the model and provider from the catalog (`modelInfo`).
        let model = match (&state.model, self.selection()) {
            (Some((_, _, variant)), Some(selection)) => {
                let (name, provider) = crate::variants::model_info(&self.providers(), &selection);
                (name, Some(provider), variant.clone())
            }
            (Some(model), None) => model.clone(),
            (None, _) => ("Default model".into(), None, None),
        };
        let shown = details && !shell;
        let queued = self.prompt.queued().len();
        let mut work = match shortcut("session.queued_prompts") {
            Some(key) if shown && queued > 0 => {
                vec![(status::Id::Queued, status::Action { key, label: format!("{queued} pending"), expanded: None })]
            }
            _ => Vec::new(),
        };
        let running = self.footers.running_subagents();
        if let Some(key) = shortcut("session.child.first").filter(|_| shown && running > 0) {
            let plural = if running == 1 { "" } else { "s" };
            let label = format!("{running} sub");
            let expanded = Some(format!("{running} subagent{plural}"));
            work.push((status::Id::Subagents, status::Action { key, label, expanded }));
        }
        let usage = state.usage.as_ref().filter(|_| details);
        status::policy(&status::Input {
            width,
            mono: self.settings.get().mono,
            status: Some((
                text,
                (details && busy).then(|| interrupt.as_ref().map(|key| format!("{key} interrupt"))).flatten(),
            )),
            escape: (shell && !takeover).then(|| status::Action {
                key: "esc".into(),
                label: "normal".into(),
                expanded: None,
            }),
            work,
            model: shown.then(|| (model.0.clone(), model.2.clone())),
            agent: shown.then(|| self.agent_label(&state.agent)),
            context: usage.filter(|usage| usage.tokens > 0).map(|usage| {
                let full = status::context_usage(usage.tokens, usage.percent);
                let compact = usage.percent.map_or_else(|| full.clone(), |percent| format!("{percent}% ctx"));
                (compact, full)
            }),
            cost: usage.and_then(|usage| usage.cost).filter(|cost| *cost != 0.0).map(status::money),
            provider: if shown { model.1.clone() } else { None },
            menu: shortcut("command.palette.show").filter(|_| !takeover && !shell).map(|key| status::Action {
                key,
                label: "menu".into(),
                expanded: None,
            }),
            spinner: busy.then(|| if self.settings.get().mono { "*" } else { "▪" }.to_owned()),
        })
    }

    /// `handleAgentSelect`: the next prompt uses `id`.
    fn select_agent(self: &Rc<Self>, id: &str) {
        if self.state.borrow().closed || self.state.borrow().agent == id {
            return;
        }
        if let Some(session) = self.session.borrow_mut().as_mut() {
            session.agent = Some(id.to_owned());
        }
        self.state.borrow_mut().agent = id.to_owned();
        self.prompt.set_agent(id);
        self.set_notice(&format!("agent {}", self.agent_label(id)));
    }

    /// `footerStatus`: what "Show status" puts in the status row.
    fn summary(&self) -> String {
        let state = self.state.borrow();
        let mut details = vec![
            if state.running { "running" } else { "idle" }.to_owned(),
            format!("agent {}", self.agent_label(&state.agent)),
        ];
        if let Some((model, _, variant)) = &state.model {
            details.push(match variant {
                Some(variant) => format!("{model} {variant}"),
                None => model.clone(),
            });
        }
        if let Some(usage) = state.usage.as_ref() {
            if usage.tokens > 0 {
                details.push(status::context_usage(usage.tokens, usage.percent));
            }
            if let Some(cost) = usage.cost.filter(|cost| *cost != 0.0) {
                details.push(status::money(cost));
            }
        }
        let queued = self.prompt.queued().len();
        if queued > 0 {
            details.push(format!("{queued} pending"));
        }
        let running = self.footers.running_subagents();
        if running > 0 {
            details.push(format!("{running} subagent{}", if running == 1 { "" } else { "s" }));
        }
        details.join(if self.settings.get().mono { " - " } else { " · " })
    }

    /// `currentAgent`: the catalog's name for the agent, else its ID in title case.
    fn agent_label(&self, agent: &str) -> String {
        self.prompt.agent_name(agent).unwrap_or_else(|| capitalize(agent))
    }

    /// The terminal title on Linux (`setTitle`): `OC | <title>`, or `OpenCode` without a real title.
    fn set_title(&self, title: Option<&str>) {
        if !cfg!(target_os = "linux") {
            return;
        }
        match title.filter(|title| !title.is_empty() && !is_fallback_title(title)) {
            None => self.app.set_title("OpenCode"),
            Some(title) => {
                let short = if title.encode_utf16().count() > 40 {
                    format!("{}…", title.chars().take(37).collect::<String>())
                } else {
                    title.to_owned()
                };
                self.app.set_title(&opencode_ui::terminal_title(&format!("OC | {short}")));
            }
        }
    }

    fn trace(&self, kind: &str, data: Value) {
        if let Some(trace) = &self.input.trace {
            trace.write(kind, data);
        }
    }
}

/// The variant a session opens with: the one its model names, else, when resuming with the session's own model,
/// the session's variant (`pickVariant` in `runtime.boot.ts`, `session.shared.ts:108-113`).
fn opened_variant(target: &SessionTarget) -> Option<String> {
    let model = target.model.as_ref()?;
    if model.variant.is_some() || !target.resume {
        return model.variant.clone();
    }
    let session = target.session.model.as_ref()?;
    (session.provider_id == model.provider_id && session.id == model.id).then(|| session.variant.clone())?
}

/// Whether an event's `sessionID(event)` names `session` (`stream-v2.transport.ts:180-183,1048-1053`).
fn own_event(event: &Value, session: &str) -> bool {
    let data = &event["data"];
    let source = if event["type"] == "form.created" { &data["form"]["sessionID"] } else { &data["sessionID"] };
    source.as_str() == Some(session)
}

/// `footerPromptLayout` and `applyHeight` for the composer: padding rows in a tall terminal, the textarea, and the
/// status row, leaving one transcript row.
pub fn prompt_height(terminal: u16, rows: u16) -> u16 {
    let padding = u16::from(terminal >= PROMPT_MAX_ROWS + 4);
    (padding * 2 + 1 + rows.max(1)).min(terminal.saturating_sub(1)).max(1)
}

/// `isFallbackTitle`: a stored `New session - <ISO time>` or `Child session - <ISO time>` title.
fn is_fallback_title(title: &str) -> bool {
    let Some(stamp) = title.strip_prefix("New session - ").or_else(|| title.strip_prefix("Child session - ")) else {
        return false;
    };
    let shape = "0000-00-00T00:00:00.000Z";
    stamp.len() == shape.len()
        && stamp.bytes().zip(shape.bytes()).all(
            |(have, want)| {
                if want == b'0' { have.is_ascii_digit() } else { have == want }
            },
        )
}

/// `directoryLabel`: the home directory as `~`, with forward slashes.
fn directory_label(directory: &str, home: &std::path::Path) -> String {
    let home = home.to_string_lossy();
    let display = if directory == home {
        "~".to_owned()
    } else if let Some(rest) = directory.strip_prefix(&format!("{home}/")) {
        format!("~/{rest}")
    } else {
        directory.to_owned()
    };
    display.replace('\\', "/")
}

fn capitalize(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `-m provider/model` on a session of that model keeps the session's variant (`pickVariant`).
    #[test]
    fn a_resumed_session_keeps_its_variant_for_its_own_model() {
        use serde::Deserialize;
        let target = |model: &str, resume: bool| {
            let session = json!({ "id": "ses_1", "projectID": "proj", "title": "t", "cost": 0,
                "model": { "providerID": "p", "id": "m", "variant": "high" },
                "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
                "time": { "created": 1, "updated": 1 }, "location": { "directory": "/tmp" } });
            SessionTarget {
                session: opencode_api::generated::SessionInfo::deserialize(&session).unwrap(),
                location: Default::default(),
                model: Some(target::parse_model(Some(model)).unwrap().unwrap()),
                agent: None,
                resume,
            }
        };
        assert_eq!(opened_variant(&target("p/m", true)).as_deref(), Some("high"));
        assert_eq!(opened_variant(&target("p/m#low", true)).as_deref(), Some("low"));
        assert_eq!(opened_variant(&target("p/other", true)), None);
        assert_eq!(opened_variant(&target("p/m", false)), None);
    }

    #[test]
    fn the_trace_keeps_only_this_sessions_events() {
        let event = |kind: &str, data: Value| json!({ "type": kind, "data": data });
        assert!(own_event(&event("session.text.delta", json!({ "sessionID": "ses_1" })), "ses_1"));
        assert!(!own_event(&event("session.text.delta", json!({ "sessionID": "ses_2" })), "ses_1"));
        assert!(own_event(&event("form.created", json!({ "form": { "sessionID": "ses_1" } })), "ses_1"));
        assert!(!own_event(&event("form.created", json!({ "form": { "sessionID": "global" } })), "ses_1"));
        assert!(!own_event(&event("model.updated", json!({})), "ses_1"));
    }

    #[test]
    fn the_footer_is_padded_in_tall_terminals() {
        assert_eq!(prompt_height(16, 1), 2);
        assert_eq!(prompt_height(17, 1), 2);
        assert_eq!(prompt_height(18, 1), 4);
        assert_eq!(prompt_height(40, 3), 6);
        assert_eq!(prompt_height(2, 1), 1);
    }

    #[test]
    fn fallback_titles_and_labels() {
        assert!(is_fallback_title("New session - 2026-11-05T10:20:30.123Z"));
        assert!(is_fallback_title("Child session - 2026-11-05T10:20:30.123Z"));
        assert!(!is_fallback_title("New session - today"));
        assert!(!is_fallback_title("Fix the bug"));
        let home = std::path::Path::new("/home/me");
        assert_eq!(directory_label("/home/me", home), "~");
        assert_eq!(directory_label("/home/me/src", home), "~/src");
        assert_eq!(directory_label("/home/meow", home), "/home/meow");
        assert_eq!(capitalize("build"), "Build");
    }
}
