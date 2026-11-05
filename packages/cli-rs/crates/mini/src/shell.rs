//! The split-footer lifecycle (`runtime.lifecycle.ts`, `runtime.ts`, the state half of `footer.ts`).
//!
//! The renderer starts in a footer at the bottom of the main screen and paints at once; the session is resolved
//! behind it. A resumed session clears the terminal and replays its transcript. Closing writes what is queued,
//! leaves split mode, and ends with a newline so the shell continues below the transcript.

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use anyhow::Context as _;
use opencode_api::client::Client;
use opencode_local::cli_config::{ThemeMode as ConfigMode, Visibility};
use opencode_store::target::{self, Prepared, SessionTarget, TargetError};
use opencode_ui::theme::ThemeMode;
use opentui::native::{KittyKeyboard, MouseTracking};
use opentui::prelude::*;
use opentui::split::{Scrollback, SplitFooter};
use serde_json::{Value, json};

use crate::footers::Footers;
use crate::prompt::queue::{Queue, Submitted, Work};
use crate::prompt::status::{self, mono_shortcut};
use crate::prompt::{Delivery, Hooks, PROMPT_MAX_ROWS, Prompt, RunPrompt};
use crate::replay::{self, Envelope, Incoming, Output, Transcript};
use crate::scrollback::{Commit, Flags, Writer};
use crate::settings::MiniSettings;
use crate::signals::{self, Trace};
use crate::theme::{self, ThemeInput};
use crate::{Input, InputError};
use unicode_width::UnicodeWidthStr;

/// `FOOTER_HEIGHT`: the footer's rows before the prompt measures itself.
const FOOTER_HEIGHT: u16 = 4;
/// How long the second Ctrl+C or Esc of a two-press gesture may wait.
const TWO_PRESS: Duration = Duration::from_secs(5);
/// `NOTICE_DURATION`.
const NOTICE: Duration = Duration::from_secs(3);

pub fn run(input: Input) -> anyhow::Result<()> {
    let settings = MiniSettings::resolve(input.config.mini.as_ref());
    let mut options = AppOptions {
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
    }
    let app = App::new(options)?;
    let footer = SplitFooter::of(app.session()).context("mini runs in a split footer")?;
    let theme_input = ThemeInput {
        name: input
            .config
            .theme
            .as_ref()
            .and_then(|theme| theme.name.clone()),
        mode: input
            .config
            .theme
            .as_ref()
            .and_then(|theme| theme.mode)
            .and_then(|mode| match mode {
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
    let writer = Writer::new(
        footer.clone(),
        Scrollback::new(&app)?,
        theme.clone(),
        settings.mono,
        true,
    );
    let prompt = Prompt::new(&app, &theme, settings.mono, &input.config);
    let status = Text::new(&app, "")
        .wrap(WrapMode::None)
        .truncate(true)
        .height(1)
        .shrink(0.0);
    app.root()
        .direction(FlexDirection::Column)
        .child(prompt.root())
        .child(prompt.menu_root())
        .child(&status);
    let mini = Rc::new(Mini {
        app: app.clone(),
        client: input.client.clone(),
        footer,
        writer: RefCell::new(writer),
        transcript: RefCell::new(None),
        footers: RefCell::new(Footers::default()),
        session: RefCell::new(None),
        prompt,
        status,
        queue: RefCell::new(Queue::default()),
        state: RefCell::new(State::default()),
        theme_input,
        settings,
        input: Meta {
            directory: input.directory.clone(),
            home: input.home.clone(),
            version: input.version.clone(),
            replay: input.replay,
            replay_limit: input.replay_limit,
            trace: input.trace.clone(),
        },
        initial: RefCell::new(input.initial_input.clone()),
        waiting: RefCell::new(Vec::new()),
        stream: RefCell::new(None),
        resize: Cell::new(None),
        size: Cell::new(mini_size(&app)),
        exit_splash: Cell::new(false),
        failure: RefCell::new(None),
    });
    mini.set_title(None);
    mini.paint_status();
    mini.apply_height();
    mini.wire();
    mini.resolve(input.target, input.start);
    mini.prompt.focus();
    let _theme_signal = signals::on_sigusr2(&app);
    app.on_message({
        let mini = mini.clone();
        move |_, _: &signals::ThemeReload| mini.refresh_theme()
    });
    let result = app.run();
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

fn mini_size(app: &App) -> (u16, u16) {
    SplitFooter::of(app.session()).map_or((0, 0), |footer| footer.terminal_size())
}

/// What the command resolved, kept for the session's lifetime.
struct Meta {
    directory: String,
    home: std::path::PathBuf,
    version: String,
    replay: bool,
    replay_limit: Option<u32>,
    trace: Option<Trace>,
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

struct Mini {
    app: App,
    client: Client,
    footer: SplitFooter,
    writer: RefCell<Writer>,
    transcript: RefCell<Option<Transcript>>,
    footers: RefCell<Footers>,
    session: RefCell<Option<Session>>,
    prompt: Prompt,
    status: Text,
    queue: RefCell<Queue>,
    state: RefCell<State>,
    theme_input: ThemeInput,
    settings: MiniSettings,
    input: Meta,
    /// The piped stdin and `--prompt`, sent once the session is ready.
    initial: RefCell<Option<String>>,
    /// Prompts submitted before the session was ready.
    waiting: RefCell<Vec<RunPrompt>>,
    stream: RefCell<Option<tokio::task::JoinHandle<()>>>,
    resize: Cell<Option<TimerId>>,
    size: Cell<(u16, u16)>,
    exit_splash: Cell<bool>,
    failure: RefCell<Option<anyhow::Error>>,
}

impl Mini {
    fn wire(self: &Rc<Self>) {
        let mini = self.clone();
        self.app.on_message(move |cx, envelope: &Envelope| {
            if let Some(incoming) = envelope.take() {
                mini.incoming(cx, incoming);
            }
        });
        let weak = Rc::downgrade(self);
        let with = move |run: fn(&Rc<Mini>)| {
            let weak = weak.clone();
            move || {
                if let Some(mini) = weak.upgrade() {
                    run(&mini);
                }
            }
        };
        let weak = Rc::downgrade(self);
        let submit = weak.clone();
        let interrupt = weak.clone();
        let status = weak.clone();
        self.prompt.set_hooks(Hooks {
            submit: Some(Box::new(move |prompt| {
                submit.upgrade().is_some_and(|mini| mini.submit(prompt))
            })),
            exit_request: Some(Box::new(with(|mini| {
                let mini = mini.clone();
                mini.app.clone().defer(move |cx| mini.request_exit(cx));
            }))),
            exit: Some(Box::new(with(|mini| {
                let mini = mini.clone();
                mini.app.clone().defer(move |cx| mini.close(cx));
            }))),
            interrupt: Some(Box::new(move || {
                interrupt
                    .upgrade()
                    .is_some_and(|mini| mini.request_interrupt())
            })),
            input_clear: Some(Box::new(with(|mini| mini.input_clear()))),
            status: Some(Box::new(move |text| {
                if let Some(mini) = status.upgrade() {
                    mini.set_notice(text);
                }
            })),
            layout: Some(Box::new(with(|mini| {
                mini.apply_height();
                mini.paint_status();
            }))),
            clear_screen: Some(Box::new(with(|mini| mini.clear_screen()))),
            // `/settings` opens M.4's settings view.
            settings: None,
        });
        drop(weak);
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
                    Ok(Prepared {
                        model: next.model,
                        agent: agent.or(next.agent),
                    })
                })
                .await
            },
            move |cx, result| match result {
                Ok(target) => mini.opened(cx, target),
                Err(TargetError::SessionNotFound) => {
                    mini.fail(cx, InputError("Session not found".into()).into())
                }
                Err(error) => mini.fail(cx, anyhow::Error::new(error)),
            },
        );
    }

    fn fail(&self, cx: &mut Cx<'_>, error: anyhow::Error) {
        *self.failure.borrow_mut() = Some(error);
        self.close(cx);
    }

    fn opened(self: &Rc<Self>, cx: &mut Cx<'_>, target: SessionTarget) {
        if self.state.borrow().closed {
            return;
        }
        let session = Session {
            id: target.session.id.0.clone(),
            title: target.session.title.clone(),
            agent: target.agent.clone(),
            directory: target.location.directory.0.clone(),
            model: target.model.as_ref().map(|model| {
                let mut value = json!({ "providerID": model.provider_id.0, "id": model.id });
                if let Some(variant) = &model.variant {
                    value["variant"] = json!(variant);
                }
                value
            }),
        };
        self.trace(
            "session.open",
            json!({ "sessionID": session.id, "resume": target.resume }),
        );
        self.set_title(session.title.as_deref());
        let model = target.model.as_ref().map(|model| {
            (
                model.id.clone(),
                Some(model.provider_id.0.clone()),
                model.variant.clone(),
            )
        });
        self.patch(|state| {
            state.agent = session.agent.clone().unwrap_or_default();
            state.model = model;
            state.usage = None;
        });
        *self.transcript.borrow_mut() = Some(Transcript::new(
            &session.id,
            self.settings.thinking == Visibility::Show,
            self.settings.tools == Visibility::Show,
            self.input.replay,
            self.input.replay_limit,
        ));
        *self.session.borrow_mut() = Some(session.clone());
        self.prompt
            .set_agent(session.agent.as_deref().unwrap_or_default());
        self.prompt
            .open(&self.client, &session.id, &session.directory, target.resume);
        if target.resume {
            self.reset_for_replay(cx);
        }
        if target.model.is_none() {
            self.load_default_model(&session.directory);
        }
        let proxy = self.app.proxy();
        let limit = self
            .input
            .replay_limit
            .unwrap_or(replay::DEFAULT_REPLAY_LIMIT);
        let task = self.app.runtime().spawn(replay::connect(
            self.client.clone(),
            session.id,
            limit,
            proxy,
        ));
        *self.stream.borrow_mut() = Some(task);
    }

    /// `loadDefaultModel`: the label of the model a session without one uses.
    fn load_default_model(self: &Rc<Self>, directory: &str) {
        let client = self.client.clone();
        let directory = directory.to_owned();
        let mini = self.clone();
        self.app.spawn(
            async move { replay::default_model(&client, &directory).await },
            move |_, model| {
                let Some((provider_id, model_id)) = model else {
                    return;
                };
                mini.patch(|state| state.model = Some((model_id, Some(provider_id), None)));
            },
        );
    }

    /// `resetForReplay`: clears the terminal and its scrollback, then writes the entry header the transcript
    /// starts under.
    fn reset_for_replay(&self, cx: &mut Cx<'_>) {
        let mut writer = self.writer.borrow_mut();
        let result = writer.complete(false).and_then(|()| {
            writer.reset(true);
            self.footer.reset_for_replay(true)?;
            let width = self.footer.renderer_size().0;
            let directory = self.session.borrow().as_ref().map_or_else(
                || self.input.directory.clone(),
                |session| session.directory.clone(),
            );
            let detail = directory_label(&directory, &self.input.home);
            let header = crate::splash::entry(
                writer.app(),
                u32::from(width),
                &self.input.version,
                &detail,
                &writer.theme().splash,
                writer.mono(),
            );
            writer.write_widget(
                &header,
                Flags {
                    start_on_new_line: true,
                    trailing_newline: false,
                },
            )
        });
        if let Err(error) = result {
            cx.fail(error);
        }
    }

    fn incoming(self: &Rc<Self>, cx: &mut Cx<'_>, incoming: Incoming) {
        if self.state.borrow().closed {
            return;
        }
        let output = {
            let mut transcript = self.transcript.borrow_mut();
            let Some(transcript) = transcript.as_mut() else {
                return;
            };
            match incoming {
                Incoming::Hydrated { messages, active } => {
                    self.trace(
                        "recv.hydrate",
                        json!({ "messages": messages.len(), "active": active }),
                    );
                    transcript.hydrate(&messages, active)
                }
                Incoming::Event(event) => {
                    self.trace("recv.event", event.clone());
                    transcript.event(&event)
                }
                Incoming::Disconnected(error) => {
                    self.trace("recv.reconnect", json!({ "error": error }));
                    transcript.connected = false;
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
        let hydrated = output.patch.is_some()
            && self
                .transcript
                .borrow()
                .as_ref()
                .is_some_and(|transcript| transcript.connected);
        self.output(cx, output);
        if hydrated {
            self.send_waiting(cx);
        }
    }

    /// Writes a transcript output: footer events, commits, then the status.
    fn output(&self, cx: &mut Cx<'_>, output: Output) {
        for event in &output.footer {
            if event["type"]
                .as_str()
                .is_some_and(|kind| kind.starts_with("session.inbox."))
            {
                self.prompt.inbox_event(event);
                self.paint_status();
            }
            self.footers.borrow_mut().event(event);
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
        if let Some(patch) = output.patch {
            let idle = patch.running == Some(false);
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
            if idle && !self.state.borrow().running {
                self.complete(cx);
            }
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
        let ready = self
            .transcript
            .borrow()
            .as_ref()
            .is_some_and(|transcript| transcript.connected);
        if !ready {
            self.waiting.borrow_mut().push(prompt);
            return true;
        }
        self.enqueue(prompt);
        true
    }

    fn send_waiting(self: &Rc<Self>, _cx: &mut Cx<'_>) {
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
            Submitted::Admit(prompt, delivery) => self.admit(prompt, delivery),
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
                patch: Some(replay::Patch {
                    running: Some(false),
                    status: Some(String::new()),
                    usage: None,
                }),
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
    }

    /// `renderPromptError`.
    fn prompt_error(self: &Rc<Self>, cx: &mut Cx<'_>, id: &str, error: String) {
        self.append(
            cx,
            Commit {
                text: error,
                ..Commit::error("").message(id)
            },
        );
    }

    /// `run`: a shell command waits for its answer; a server command is admitted; an ordinary prompt switches
    /// the agent and model, is admitted with its delivery (`steer` by default), and waits for the session to
    /// settle, then prints what the live stream missed (`runPromptTurn`).
    fn send(self: &Rc<Self>, prompt: RunPrompt) {
        let Some(session) = self.session.borrow().clone() else {
            return;
        };
        let client = self.client.clone();
        let mini = self.clone();
        if prompt.shell {
            let id = opencode_api::id::message();
            self.sending("running shell");
            self.trace(
                "send.shell",
                json!({ "sessionID": session.id, "id": id, "command": prompt.text }),
            );
            let command = prompt.text.clone();
            self.app.spawn(
                {
                    let id = id.clone();
                    async move { crate::prompt::api::shell(&client, &session.id, &id, &command).await }
                },
                move |cx, result| {
                    if let Err(error) = result {
                        mini.prompt_error(cx, &id, error);
                    }
                    mini.finish(cx);
                },
            );
            return;
        }
        let id = prompt
            .message_id
            .clone()
            .unwrap_or_else(opencode_api::id::message);
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
        let text = prompt.text.clone();
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
                    let prompt = RunPrompt {
                        message_id: Some(id),
                        ..prompt
                    };
                    crate::prompt::api::admit(&client, &session.id, &prompt, delivery).await
                }
            },
            move |cx, result| match result {
                Ok(()) if command => {
                    mini.turn_summary(cx, started);
                    mini.finish(cx);
                }
                Ok(()) => {
                    let output = mini
                        .transcript
                        .borrow_mut()
                        .as_mut()
                        .map(|transcript| transcript.admitted(&id, &text))
                        .unwrap_or_default();
                    mini.output(cx, output);
                    mini.settle(&session.id, started);
                }
                Err(error) => {
                    mini.prompt_error(cx, &id, error);
                    mini.finish(cx);
                }
            },
        );
    }

    /// A prompt submitted while an ordinary turn runs goes to the inbox at once (`input.admit`).
    fn admit(self: &Rc<Self>, prompt: RunPrompt, delivery: Delivery) {
        let Some(session) = self.session.borrow().clone() else {
            return;
        };
        let id = prompt.message_id.clone().unwrap_or_default();
        self.trace(
            "send.prompt",
            json!({ "sessionID": session.id, "messageID": id, "delivery": delivery.as_str() }),
        );
        let client = self.client.clone();
        let mini = self.clone();
        let command = prompt.command.is_some();
        let text = prompt.text.clone();
        self.app.spawn(
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
                crate::prompt::api::admit(&client, &session.id, &prompt, delivery).await
            },
            move |cx, result| match result {
                Ok(()) => {
                    mini.prompt.admitted(&id, delivery);
                    mini.paint_status();
                    let output = mini
                        .transcript
                        .borrow_mut()
                        .as_mut()
                        .map(|transcript| transcript.admitted(&id, &text))
                        .unwrap_or_default();
                    mini.output(cx, output);
                }
                Err(error) => mini.prompt_error(cx, &id, error),
            },
        );
    }

    /// `/compact`: `session.compact`.
    fn compact(self: &Rc<Self>) {
        let Some(session) = self.session.borrow().clone() else {
            return;
        };
        self.sending("compacting session");
        let client = self.client.clone();
        let mini = self.clone();
        self.app.spawn(
            async move { crate::prompt::api::compact(&client, &session.id).await },
            move |cx, result| {
                if let Err(error) = result {
                    let id = opencode_api::id::message();
                    mini.prompt_error(cx, &id, error);
                }
                mini.finish(cx);
            },
        );
    }

    /// `/new`: a new session at the launch directory, with the current agent and model (`onNewSession`).
    fn new_session(self: &Rc<Self>) {
        let Some(session) = self.session.borrow().clone() else {
            return;
        };
        self.sending("starting new session");
        let client = self.client.clone();
        let mini = self.clone();
        let model = session.model.as_ref().and_then(|model| {
            Some(opencode_api::generated::ModelRef {
                provider_id: opencode_api::generated::ProviderID(
                    model["providerID"].as_str()?.to_owned(),
                ),
                id: model["id"].as_str()?.to_owned(),
                variant: model["variant"].as_str().map(str::to_owned),
            })
        });
        let input = target::TargetInput {
            directory: Some(self.input.directory.clone()),
            agent: session.agent.clone(),
            model,
            ..target::TargetInput::default()
        };
        let agent = session.agent.clone();
        self.app.spawn(
            async move {
                target::resolve_session_target(&client, input, |next| async move {
                    Ok(Prepared {
                        model: next.model,
                        agent: agent.or(next.agent),
                    })
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
        let limit = self
            .input
            .replay_limit
            .unwrap_or(replay::DEFAULT_REPLAY_LIMIT);
        let mini = self.clone();
        self.app.spawn(
            {
                let session = session.clone();
                async move {
                    replay::wait(&client, &session).await?;
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
                if mini.queue.borrow_mut().take_admissions() {
                    mini.settle(&session, started);
                    return;
                }
                mini.turn_summary(cx, started);
                mini.finish(cx);
            },
        );
    }

    /// `turn.duration`: the agent, model, and time of a finished turn, below its answer.
    fn turn_summary(&self, cx: &mut Cx<'_>, started: std::time::Instant) {
        if self.settings.turn_summary == Visibility::Hide {
            return;
        }
        let model = self
            .session
            .borrow()
            .as_ref()
            .and_then(|session| session.model.as_ref()?["id"].as_str().map(str::to_owned))
            .or_else(|| Some(self.state.borrow().model.as_ref()?.0.clone()))
            .unwrap_or_else(|| "Default model".into());
        let summary = crate::scrollback::TurnSummary {
            agent: self.agent_label(&self.state.borrow().agent),
            model,
            duration: duration(started.elapsed().as_millis() as u64),
        };
        let mut commit = Commit::system(format!(
            "{} · {} · {}",
            summary.agent, summary.model, summary.duration
        ));
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
        let timer = self
            .app
            .set_timeout(TWO_PRESS, move |_| mini.patch(|state| state.exit = 0));
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
            let timer = self
                .app
                .set_timeout(TWO_PRESS, move |_| mini.patch(|state| state.interrupt = 0));
            if let Some(previous) = self.state.borrow_mut().interrupt_timer.replace(timer) {
                self.app.cancel_timer(previous);
            }
            self.paint_status();
            return true;
        }
        self.patch(|state| state.interrupt = 0);
        self.set_notice("interrupting");
        let Some(session) = self.session.borrow().clone() else {
            return true;
        };
        self.trace("send.interrupt", json!({ "sessionID": session.id }));
        let client = self.client.clone();
        self.app.spawn(
            async move { replay::interrupt(&client, &session.id).await },
            |_, result| {
                if let Err(error) = result {
                    log::warn!("mini interrupt failed: {error}");
                }
            },
        );
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
        let weak = Rc::downgrade(self);
        let timer = self.app.set_timeout(NOTICE, move |_| {
            if let Some(mini) = weak.upgrade() {
                mini.patch(|state| {
                    state.notice.clear();
                    state.notice_timer = None;
                });
            }
        });
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
        if let Some(session) = session
            && self.settings.splash == Visibility::Show
        {
            let writer = self.writer.borrow();
            if let Some(banner) = crate::splash::exit(
                writer.app(),
                session.title.as_deref(),
                &session.id,
                &writer.theme().splash,
                writer.mono(),
            ) && writer
                .write_widget(
                    &banner,
                    Flags {
                        start_on_new_line: true,
                        trailing_newline: true,
                    },
                )
                .is_ok()
            {
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
        let session = {
            let mut transcript = self.transcript.borrow_mut();
            let Some(transcript) = transcript.as_mut() else {
                return;
            };
            if !self.input.replay || !transcript.connected || transcript.replaying() {
                return;
            }
            transcript.begin_replay();
            transcript.session_id.clone()
        };
        self.trace("replay.resize", json!({ "sessionID": session }));
        let client = self.client.clone();
        let limit = self
            .input
            .replay_limit
            .unwrap_or(replay::DEFAULT_REPLAY_LIMIT);
        let mini = self.clone();
        self.app.spawn(
            async move { replay::hydration(&client, &session, limit).await },
            move |cx, result| {
                let output = match result {
                    Ok((messages, active)) => {
                        mini.reset_for_replay(cx);
                        mini.transcript
                            .borrow_mut()
                            .as_mut()
                            .map(|transcript| transcript.replayed(&messages, active))
                    }
                    // Nothing was cleared; the events that waited still apply.
                    Err(error) => {
                        log::warn!("mini resize replay failed: {error}");
                        mini.transcript
                            .borrow_mut()
                            .as_mut()
                            .map(Transcript::abort_replay)
                    }
                };
                if let Some(output) = output {
                    mini.output(cx, output);
                }
            },
        );
    }

    /// Re-resolves the theme (SIGUSR2, resize). New entries take it; written rows keep theirs.
    fn refresh_theme(&self) {
        let theme = theme::resolve(&self.theme_input);
        self.prompt.set_theme(&theme);
        self.writer.borrow_mut().set_theme(theme);
        self.paint_status();
    }

    /// `applyHeight` for the composer: the prompt's rows, padded in a tall terminal, plus the status row unless
    /// the autocomplete menu replaces it.
    fn apply_height(&self) {
        let terminal = self.footer.terminal_size();
        let height = prompt_height(terminal.1, self.prompt.rows(terminal));
        self.status.visible(!self.prompt.menu_visible());
        if let Err(error) = self.footer.set_footer_height(height) {
            log::warn!("mini could not set the footer height: {error}");
        }
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
        let separator = if self.settings.mono { " - " } else { " · " };
        let mut spans: Vec<Span> = Vec::new();
        let mut previous = None;
        for group in &groups {
            match previous {
                None => {}
                Some(status::Id::Spinner) => spans.push(" ".fg(theme.footer.muted)),
                Some(_) => spans.push(separator.fg(theme.footer.muted)),
            }
            for (text, tone) in &group.parts {
                let color = match (group.id, tone) {
                    // M.4 animates the spinner; it stands still in the agent's color until then.
                    (status::Id::Spinner, _) | (_, status::Tone::Agent) => agent,
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
            keymap
                .shortcut(id)
                .filter(|key| !key.is_empty())
                .map(|key| mono_shortcut(&key, self.settings.mono))
        };
        let interrupt = shortcut("session.interrupt").map(|key| {
            if key == "escape" {
                "esc".to_owned()
            } else {
                key
            }
        });
        let busy = state.running;
        let armed = state.interrupt > 0;
        let exiting = state.exit > 0;
        let notice = state.notice.trim();
        let shell = self.prompt.shell();
        let takeover = exiting || (busy && armed) || !notice.is_empty();
        let details = self.settings.footer == Visibility::Show && !takeover;
        let width = usize::from(self.footer.terminal_size().0);
        let status_width = width.saturating_sub(if busy { 2 } else { 0 }).max(1);
        let text = if exiting || (busy && armed) {
            let key = if exiting {
                shortcut("prompt.clear")
            } else {
                interrupt.clone()
            };
            let (verb, action) = if exiting {
                ("exit", "exit")
            } else {
                ("interrupt", "stop")
            };
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
                    phrases
                        .iter()
                        .find(|text| text.width() <= status_width)
                        .unwrap_or(&phrases[3])
                        .clone()
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
                interrupt
                    .as_ref()
                    .map_or_else(|| "Running".to_owned(), |key| format!("{key} stop"))
            }
        } else if !state.status.trim().is_empty() {
            state.status.trim().to_owned()
        } else {
            if shell { "Shell" } else { "" }.to_owned()
        };
        let model = state
            .model
            .clone()
            .unwrap_or_else(|| ("Default model".into(), None, None));
        let shown = details && !shell;
        let queued = self.prompt.queued().len();
        let work = match shortcut("session.queued_prompts") {
            Some(key) if shown && queued > 0 => vec![(
                status::Id::Queued,
                status::Action {
                    key,
                    label: format!("{queued} pending"),
                    expanded: None,
                },
            )],
            _ => Vec::new(),
        };
        let usage = state.usage.as_ref().filter(|_| details);
        status::policy(&status::Input {
            width,
            mono: self.settings.mono,
            status: Some((
                text,
                (details && busy)
                    .then(|| interrupt.as_ref().map(|key| format!("{key} interrupt")))
                    .flatten(),
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
                let compact = usage
                    .percent
                    .map_or_else(|| full.clone(), |percent| format!("{percent}% ctx"));
                (compact, full)
            }),
            cost: usage
                .and_then(|usage| usage.cost)
                .filter(|cost| *cost != 0.0)
                .map(status::money),
            provider: if shown { model.1.clone() } else { None },
            menu: shortcut("command.palette.show")
                .filter(|_| !takeover && !shell)
                .map(|key| status::Action {
                    key,
                    label: "menu".into(),
                    expanded: None,
                }),
            spinner: busy.then(|| if self.settings.mono { "*" } else { "▪" }.to_owned()),
        })
    }

    /// `currentAgent`: the catalog's name for the agent, else its ID in title case.
    fn agent_label(&self, agent: &str) -> String {
        self.prompt
            .agent_name(agent)
            .unwrap_or_else(|| capitalize(agent))
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
                self.app.set_title(&format!("OC | {short}"));
            }
        }
    }

    fn trace(&self, kind: &str, data: Value) {
        if let Some(trace) = &self.input.trace {
            trace.write(kind, data);
        }
    }
}

/// `footerPromptLayout` and `applyHeight` for the composer: padding rows in a tall terminal, the textarea, and the
/// status row, leaving one transcript row.
pub fn prompt_height(terminal: u16, rows: u16) -> u16 {
    let padding = u16::from(terminal >= PROMPT_MAX_ROWS + 4);
    (padding * 2 + 1 + rows.max(1))
        .min(terminal.saturating_sub(1))
        .max(1)
}

/// `isFallbackTitle`: a stored `New session - <ISO time>` or `Child session - <ISO time>` title.
fn is_fallback_title(title: &str) -> bool {
    let Some(stamp) = title
        .strip_prefix("New session - ")
        .or_else(|| title.strip_prefix("Child session - "))
    else {
        return false;
    };
    let shape = "0000-00-00T00:00:00.000Z";
    stamp.len() == shape.len()
        && stamp.bytes().zip(shape.bytes()).all(|(have, want)| {
            if want == b'0' {
                have.is_ascii_digit()
            } else {
                have == want
            }
        })
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

/// `Locale.duration`.
pub fn duration(ms: u64) -> String {
    match ms {
        0..1_000 => format!("{ms}ms"),
        // `toFixed(1)` rounds the exact decimal half up; `{:.1}` would round half to even.
        1_000..60_000 => {
            let tenths = (ms + 50) / 100;
            format!("{}.{}s", tenths / 10, tenths % 10)
        }
        60_000..3_600_000 => format!("{}m {}s", ms / 60_000, ms % 60_000 / 1000),
        3_600_000..86_400_000 => format!("{}h {}m", ms / 3_600_000, ms % 3_600_000 / 60_000),
        _ => format!("{}d {}h", ms / 86_400_000, ms % 86_400_000 / 3_600_000),
    }
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
        assert!(is_fallback_title(
            "Child session - 2026-11-05T10:20:30.123Z"
        ));
        assert!(!is_fallback_title("New session - today"));
        assert!(!is_fallback_title("Fix the bug"));
        let home = std::path::Path::new("/home/me");
        assert_eq!(directory_label("/home/me", home), "~");
        assert_eq!(directory_label("/home/me/src", home), "~/src");
        assert_eq!(directory_label("/home/meow", home), "/home/meow");
        assert_eq!(capitalize("build"), "Build");
        assert_eq!(duration(950), "950ms");
        assert_eq!(duration(1_250), "1.3s");
        assert_eq!(duration(61_000), "1m 1s");
        assert_eq!(duration(3_660_000), "1h 1m");
    }
}
