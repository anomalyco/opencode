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
use crate::prompt::{Prompt, RunPrompt};
use crate::replay::{self, Envelope, Incoming, Output, Transcript};
use crate::scrollback::{Commit, Flags, Writer};
use crate::settings::MiniSettings;
use crate::signals::{self, Trace};
use crate::theme::{self, ThemeInput};
use crate::variants::{ModelSelection, format_model_label};
use crate::{Input, InputError};

/// `FOOTER_HEIGHT`: the footer's rows before the prompt measures itself.
const FOOTER_HEIGHT: u16 = 4;
/// `PROMPT_MAX_ROWS`: a terminal at least this plus four rows tall pads the prompt.
const PROMPT_MAX_ROWS: u16 = 14;
/// How long the second Ctrl+C or Esc of a two-press gesture may wait.
const TWO_PRESS: Duration = Duration::from_secs(5);

pub fn run(input: Input) -> anyhow::Result<()> {
    let settings = MiniSettings::resolve(input.config.mini.as_ref());
    let mut options = AppOptions {
        exit_on_ctrl_c: false,
        light_theme: None,
        palette_size: 256,
        ..AppOptions::default()
    };
    // The footer starts at the composer's height: a height set before the first frame does not resize the
    // renderer, so `FOOTER_HEIGHT` would leave the status row below the screen.
    let rows = opentui::term::size().map_or(0, |(_, rows)| rows);
    options.host.split_footer = Some(if rows == 0 {
        FOOTER_HEIGHT
    } else {
        prompt_height(rows, crate::prompt::MIN_ROWS)
    });
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
    let prompt = Prompt::new(&app, &theme, settings.mono);
    let status = Text::new(&app, "")
        .wrap(WrapMode::None)
        .truncate(true)
        .height(1)
        .shrink(0.0);
    let body = View::new(&app).child(prompt.root());
    app.root()
        .direction(FlexDirection::Column)
        .child(&body)
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
        body,
        status,
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
    model: String,
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
    body: View,
    status: Text,
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
        let mini = self.clone();
        self.prompt
            .on_submit(move |cx, prompt| mini.submit(cx, prompt));
        let mini = self.clone();
        self.app.on_key(move |cx, key| {
            if key.matches("ctrl+c") {
                cx.stop_propagation();
                if mini.prompt.value().is_empty() {
                    mini.request_exit(cx);
                } else {
                    mini.prompt.clear();
                    mini.patch(|state| {
                        state.exit = 0;
                        state.interrupt = 0;
                    });
                }
            } else if key.matches("ctrl+d") && mini.prompt.value().is_empty() {
                cx.stop_propagation();
                mini.close(cx);
            } else if key.matches("escape") {
                cx.stop_propagation();
                mini.request_interrupt(cx);
            }
        });
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
        let label = target.model.as_ref().map(|model| {
            format_model_label(
                &ModelSelection {
                    provider_id: model.provider_id.0.clone(),
                    model_id: model.id.clone(),
                },
                model.variant.as_deref(),
            )
        });
        self.patch(|state| {
            state.agent = session.agent.clone().unwrap_or_default();
            state.model = label.unwrap_or_else(|| "Default model".into());
        });
        *self.transcript.borrow_mut() = Some(Transcript::new(
            &session.id,
            self.settings.thinking == Visibility::Show,
            self.settings.tools == Visibility::Show,
            self.input.replay,
            self.input.replay_limit,
        ));
        *self.session.borrow_mut() = Some(session.clone());
        if target.resume {
            self.prompt.set_first(false);
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
                let label = format_model_label(
                    &ModelSelection {
                        provider_id,
                        model_id,
                    },
                    None,
                );
                mini.patch(|state| state.model = label);
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
                if !state.running {
                    state.interrupt = 0;
                }
            });
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

    /// A submitted prompt: an exit word closes mini; anything else is sent, or waits for the session.
    fn submit(self: &Rc<Self>, cx: &mut Cx<'_>, prompt: RunPrompt) {
        if crate::prompt::is_exit(&prompt.text) {
            self.close(cx);
            return;
        }
        let ready = self
            .transcript
            .borrow()
            .as_ref()
            .is_some_and(|transcript| transcript.connected);
        if !ready {
            self.waiting.borrow_mut().push(prompt);
            return;
        }
        self.send(cx, prompt);
    }

    fn send_waiting(self: &Rc<Self>, cx: &mut Cx<'_>) {
        let initial = self.initial.borrow_mut().take();
        if let Some(text) = initial.filter(|text| !text.trim().is_empty()) {
            self.send(
                cx,
                RunPrompt {
                    message_id: Some(opencode_api::id::message()),
                    text,
                    ..RunPrompt::default()
                },
            );
        }
        let waiting = std::mem::take(&mut *self.waiting.borrow_mut());
        for prompt in waiting {
            self.send(cx, prompt);
        }
    }

    /// `runPromptTurn`: switch the agent and model, admit the prompt with `delivery: "steer"`, wait for the
    /// session to settle, then print what the live stream missed.
    fn send(self: &Rc<Self>, _cx: &mut Cx<'_>, prompt: RunPrompt) {
        let Some(session) = self.session.borrow().clone() else {
            return;
        };
        let id = prompt
            .message_id
            .clone()
            .unwrap_or_else(opencode_api::id::message);
        self.patch(|state| {
            state.running = true;
            state.turn = true;
            state.status = "sending prompt".into();
            state.interrupt = 0;
            state.exit = 0;
        });
        self.trace(
            "send.prompt",
            json!({ "sessionID": session.id, "messageID": id, "delivery": "steer" }),
        );
        let client = self.client.clone();
        let mini = self.clone();
        let text = prompt.text.clone();
        let failed = Commit::error("").message(&id);
        let started = std::time::Instant::now();
        self.app.spawn(
            {
                let (session, id, text) = (session.clone(), id.clone(), text.clone());
                async move {
                    replay::prompt(
                        &client,
                        &session.id,
                        &id,
                        &text,
                        session.agent.as_deref(),
                        session.model.as_ref(),
                    )
                    .await
                }
            },
            move |cx, result| match result {
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
                    mini.patch(|state| state.turn = false);
                    mini.append(
                        cx,
                        Commit {
                            text: error,
                            ..failed
                        },
                    );
                    mini.output(
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
            },
        );
    }

    /// `settleSession`: waits until the session is idle, then lists its messages.
    fn settle(self: &Rc<Self>, session: &str, started: std::time::Instant) {
        let client = self.client.clone();
        let session = session.to_owned();
        let limit = self
            .input
            .replay_limit
            .unwrap_or(replay::DEFAULT_REPLAY_LIMIT);
        let mini = self.clone();
        self.app.spawn(
            async move {
                replay::wait(&client, &session).await?;
                replay::messages(&client, &session, limit).await
            },
            move |cx, result| {
                mini.patch(|state| state.turn = false);
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
                output.patch = Some(replay::Patch {
                    running: Some(false),
                    status: Some(String::new()),
                    usage: None,
                });
                mini.output(cx, output);
                mini.turn_summary(cx, started);
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
            .unwrap_or_else(|| self.state.borrow().model.clone());
        let summary = crate::scrollback::TurnSummary {
            agent: capitalize(&self.state.borrow().agent),
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
    fn request_interrupt(self: &Rc<Self>, _cx: &mut Cx<'_>) {
        let interrupt = {
            let mut state = self.state.borrow_mut();
            if state.closed || !state.running {
                return;
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
            return;
        }
        self.patch(|state| {
            state.interrupt = 0;
            state.notice = "interrupting".into();
        });
        let Some(session) = self.session.borrow().clone() else {
            return;
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

    /// `applyHeight` for the composer: the prompt's rows, padded in a tall terminal, plus the status row.
    fn apply_height(&self) {
        let terminal = self.footer.terminal_size().1;
        let height = prompt_height(terminal, self.prompt.rows());
        let padding = u16::from(terminal >= PROMPT_MAX_ROWS + 4);
        self.body.padding_y(u32::from(padding));
        if let Err(error) = self.footer.set_footer_height(height) {
            log::warn!("mini could not set the footer height: {error}");
        }
    }

    fn patch(&self, change: impl FnOnce(&mut State)) {
        change(&mut self.state.borrow_mut());
        self.paint_status();
    }

    /// The status row: the two-press hints, else the agent and model, then the status.
    fn paint_status(&self) {
        let state = self.state.borrow();
        let theme = self.writer.borrow().theme().clone();
        let separator = if self.settings.mono { " - " } else { " · " };
        let content: Vec<Span> = if state.exit > 0 {
            vec![
                "Press ctrl+c again to exit"
                    .to_owned()
                    .fg(theme.footer.warning),
            ]
        } else if state.interrupt > 0 {
            vec![
                "Press esc again to interrupt"
                    .to_owned()
                    .fg(theme.footer.warning),
            ]
        } else {
            let agent = capitalize(&state.agent);
            let mut spans = Vec::new();
            if !agent.is_empty() {
                spans.push(agent.fg(theme.footer.text));
            }
            if !state.model.is_empty() {
                let lead = if spans.is_empty() { "" } else { separator };
                let model = if self.settings.mono {
                    state.model.replace(" · ", separator)
                } else {
                    state.model.clone()
                };
                spans.push(format!("{lead}{model}").fg(theme.footer.muted));
            }
            let note = if state.notice.is_empty() {
                &state.status
            } else {
                &state.notice
            };
            if !note.is_empty() {
                spans.push(format!("{separator}{note}").fg(theme.footer.muted));
            }
            spans
        };
        self.status.set_text(content);
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
