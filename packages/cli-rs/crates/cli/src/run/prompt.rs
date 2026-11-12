//! The prompt of a non-interactive run (`runNonInteractivePrompt`, `packages/cli/src/run/noninteractive.ts`):
//!
//!   admitting → running → settling → waiting for this prompt's jobs → done(exit code)
//!   any state + abort (SIGINT/SIGTERM) → cancelling → done
//!
//! Events and messages stay JSON, as the TS client reads them: `--format json` passes their fields through
//! unchanged, unknown ones included.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::io::IsTerminal;
use std::rc::Rc;

use futures_util::StreamExt;
use futures_util::future::join_all;
use futures_util::stream::LocalBoxStream;
use opencode_api::client::{Call, Client};
use opencode_api::error::Error as ApiError;
use opencode_api::generated::*;
use opencode_api::transport::SseResponse;
use opencode_ui::terminal_text;
use opencode_ui::tool_info::{tool_inline_info, tool_output_text};
use opencode_util::json_object;
use serde_json::value::RawValue;
use serde_json::{Value, json};
use tokio::sync::watch;
use tokio::task::AbortHandle;

use super::files::Prepared;
use super::ui;

const QUESTION_CANCELLED_FEEDBACK: &str = "This non-interactive run cannot ask the user questions, so the question was cancelled. Continue without an answer; make reasonable assumptions and state them.";

const PERMISSION_REJECTED_FEEDBACK: &str = "This non-interactive run cannot ask the user for permission, so the request was rejected. Continue without this action.";

pub struct Input {
    pub client: Client,
    pub session_id: String,
    /// The target location's directory.
    pub directory: String,
    pub message: String,
    pub files: Vec<Prepared>,
    pub agent: Option<String>,
    /// The model, with the variant.
    pub model: Option<ModelRef>,
    pub thinking: bool,
    pub json: bool,
    pub auto: bool,
    /// The server is private to this run, so MCP input requests in its location are this run's too.
    pub standalone: bool,
    /// True on SIGINT or SIGTERM: the run cancels its Session and background jobs, then returns.
    pub signal: watch::Receiver<bool>,
    /// `process.exitCode`.
    pub exit: Rc<Cell<u8>>,
}

type Events = LocalBoxStream<'static, Result<Value, ApiError>>;

#[derive(Clone, Copy, PartialEq)]
enum Phase {
    Running,
    Settled,
    Cancelling,
}

#[derive(Clone, PartialEq)]
enum Admission {
    NotSent,
    Pending,
    /// The admitted prompt's `time.created`.
    Admitted(f64),
    Failed,
}

#[derive(Clone)]
struct Outcome {
    id: String,
    outcome: String,
    error: Option<Value>,
}

struct Settled {
    found: bool,
    messages: Vec<Value>,
    background: bool,
}

struct Run {
    input: Input,
    message_id: String,
    phase: Cell<Phase>,
    promoted: Cell<bool>,
    admission: watch::Sender<Admission>,
    failure: RefCell<Option<Value>>,
    outcomes: RefCell<Vec<Outcome>>,
    // Sessions in this run's tree that own jobs; an execution ending in one can change background state.
    job_sessions: RefCell<Vec<String>>,
    // Counts the executions that ended in a job session; an error once the event stream failed, since no
    // further end could be seen.
    ended: watch::Sender<Result<u64, String>>,
    // Subagents' asks belong to this run too; other sessions on a shared server must be left alone.
    owned: RefCell<HashMap<String, bool>>,
    consumer: RefCell<Option<AbortHandle>>,
    render: Renderer,
}

pub async fn run(input: Input) -> Result<(), String> {
    let response =
        input.client.event_subscribe(&EventSubscribeInput::default()).await.map_err(|error| error.error_message())?;
    let mut events = Box::pin(SseResponse::<Box<RawValue>>::new(response.response).events(|| {}));
    if !matches!(events.next().await, Some(Ok(_))) {
        return Err("Event stream disconnected before prompt admission".into());
    }
    let stream: Events = Box::pin(events.filter_map(|event| std::future::ready(parse(event))));
    let session_id = input.session_id.clone();
    let render = Renderer {
        session_id: session_id.clone(),
        directory: input.directory.clone(),
        json: input.json,
        thinking: input.thinking,
        starts: RefCell::default(),
        tools: RefCell::default(),
        steps: RefCell::default(),
        printed: RefCell::default(),
    };
    let run = Rc::new(Run {
        input,
        message_id: opencode_api::id::message(),
        phase: Cell::new(Phase::Running),
        promoted: Cell::new(false),
        admission: watch::channel(Admission::NotSent).0,
        failure: RefCell::default(),
        outcomes: RefCell::default(),
        job_sessions: RefCell::new(vec![session_id.clone()]),
        ended: watch::channel(Ok(0)).0,
        owned: RefCell::new(HashMap::from([(session_id, true)])),
        consumer: RefCell::default(),
        render,
    });
    let result = run.clone().settle(stream).await;
    if let Some(consumer) = run.consumer.borrow_mut().take() {
        consumer.abort();
    }
    result
}

/// Parses an event for `Run::consume`. Text and reasoning deltas, most of a reply, reach no branch there, so
/// a borrowed read of the type drops them without building their tree.
fn parse(event: Result<Box<RawValue>, ApiError>) -> Option<Result<Value, ApiError>> {
    #[derive(serde::Deserialize)]
    struct Head<'a> {
        #[serde(rename = "type")]
        kind: &'a str,
    }
    let raw = match event {
        Ok(raw) => raw,
        Err(error) => return Some(Err(error)),
    };
    let head = serde_json::from_str::<Head>(raw.get());
    if head.is_ok_and(|head| matches!(head.kind, "session.text.delta" | "session.reasoning.delta")) {
        return None;
    }
    Some(serde_json::from_str(raw.get()).map_err(|error| ApiError::MalformedResponse(error.to_string())))
}

impl Run {
    async fn settle(self: Rc<Self>, stream: Events) -> Result<(), String> {
        // The lifecycle keeps running after an abort, as the TS promise does, so an admission in flight
        // still completes and cancellation can see it.
        let lifecycle = tokio::task::spawn_local(self.clone().lifecycle(stream));
        let mut signal = self.input.signal.clone();
        let aborted = async move {
            if signal.wait_for(|aborted| *aborted).await.is_err() {
                std::future::pending::<()>().await;
            }
        };
        let settled = tokio::select! {
            result = lifecycle => result.map_err(|error| error.to_string())??,
            _ = aborted => None,
        };
        // Requests failing during or after cancellation (e.g. the private server shutting down) are ignored.
        let Some(settled) = settled else {
            let _ = self.cancel().await;
            return Ok(());
        };
        self.phase.set(Phase::Settled);
        self.render.reconcile(&settled.messages);
        if let Some(error) = final_error(&settled, self.failure.borrow().clone(), &self.outcomes.borrow()) {
            self.input.exit.set(1);
            self.render.error(&error);
        }
        Ok(())
    }

    async fn lifecycle(self: Rc<Self>, stream: Events) -> Result<Option<Settled>, String> {
        // admitting
        let client = &self.input.client;
        let session = SessionID(self.input.session_id.clone());
        if let Some(agent) = &self.input.agent {
            client
                .session_switch_agent(&SessionSwitchAgentInput {
                    session_id: session.clone(),
                    agent: AgentID(agent.clone()),
                })
                .await
                .map_err(|error| error.error_message())?;
        }
        if let Some(model) = &self.input.model {
            // The TS key order, `{ providerID, id, variant }`; the generated `ModelRef` puts `id` first.
            let input = SessionSwitchModelInput { session_id: session.clone(), ..Default::default() };
            let mut call = Client::session_switch_model_call(&input).map_err(|error| error.error_message())?;
            call.json(&json!({ "model": json_object! { "providerID": model.provider_id.0, "id": model.id, "variant"?: &model.variant } }))
            .map_err(|error| error.error_message())?;
            client.empty(call).await.map_err(|error| error.error_message())?;
        }
        if *self.input.signal.borrow() {
            return Ok(None);
        }
        let consumer = tokio::task::spawn_local({
            let run = self.clone();
            async move {
                if let Err(error) = run.clone().consume(stream).await {
                    let _ = run.ended.send_replace(Err(error));
                }
            }
        });
        *self.consumer.borrow_mut() = Some(consumer.abort_handle());
        self.admission.send_replace(Admission::Pending);
        let admitted = self.admit().await;
        self.admission.send_replace(match &admitted {
            Ok(created) => Admission::Admitted(*created),
            Err(_) => Admission::Failed,
        });
        admitted?;
        let (permissions, forms, globals) = tokio::join!(
            self.data(Client::permission_list_call(&PermissionListInput { session_id: session.clone() })),
            self.data(Client::session_form_list_call(&SessionFormListInput { session_id: session.0.clone() })),
            async {
                if !self.input.standalone {
                    return None;
                }
                let location = LocationQueryInput { directory: Some(self.input.directory.clone()) };
                let call = Client::form_list_call(&FormListInput { location: Some(location) });
                async { client.json::<Value>(call?).await }.await.ok()
            },
        );
        let permissions = permissions.unwrap_or_default();
        let forms = forms.unwrap_or_default();
        let globals = globals.unwrap_or_default();
        let owned_globals =
            array(&globals["data"]).iter().filter(|form| self.owns_global_form(form, globals.get("location")));
        let (_, cancelled) = tokio::join!(
            join_all(array(&permissions).iter().map(|request| self.reply_permission(request))),
            join_all(array(&forms).iter().chain(owned_globals).map(|form| self.cancel_form(form))),
        );
        cancelled.into_iter().collect::<Result<Vec<_>, _>>()?;

        // running → settling → waiting for this prompt's jobs
        let mut waited = false;
        let mut shown = 0;
        loop {
            let mark = self.ended_mark();
            self.session_wait().await?;
            if *self.input.signal.borrow() {
                return Ok(None);
            }
            let (found, messages) = self.projected_messages().await?;
            let failed = self.failure.borrow().is_some();
            if failed || !self.outcomes.borrow().is_empty() || messages.iter().any(|item| item["type"] == "idle") {
                let pending = if failed { None } else { self.background().await? };
                let Some(pending) = pending else { return Ok(Some(Settled { found, messages, background: waited })) };
                if !pending.is_empty() && pending.len() != shown {
                    self.render.waiting(&pending);
                }
                if !pending.is_empty() {
                    shown = pending.len();
                }
                waited = true;
            }
            self.ended_since(mark).await?;
        }
    }

    /// Sends the prompt and returns its `time.created`.
    async fn admit(&self) -> Result<f64, String> {
        let text = std::iter::once(self.input.message.as_str())
            .chain(self.input.files.iter().filter_map(|file| match file {
                Prepared::Text(text) => Some(text.as_str()),
                Prepared::Attachment { .. } => None,
            }))
            .collect::<Vec<_>>()
            .join("\n\n");
        let files = self
            .input
            .files
            .iter()
            .filter_map(|file| match file {
                Prepared::Attachment { uri, name } => {
                    Some(PromptInputFileAttachment { uri: uri.clone(), name: Some(name.clone()), ..Default::default() })
                }
                Prepared::Text(_) => None,
            })
            .collect();
        let input = SessionPromptInput {
            session_id: SessionID(self.input.session_id.clone()),
            id: Some(Some(SessionMessageID(self.message_id.clone()))),
            text,
            files: Some(files),
            delivery: Some(Some(SessionInboxDelivery::Steer)),
            ..Default::default()
        };
        let admitted = self.data(Client::session_prompt_call(&input)).await.map_err(|error| error.error_message())?;
        Ok(admitted["time"]["created"].as_f64().unwrap_or(f64::NAN))
    }

    // cancelling: a wake can still start after the interrupt (the notice each cancelled job queues), so the
    // consumer interrupts every execution that starts until the tree is quiet.
    async fn cancel(&self) -> Result<(), String> {
        self.phase.set(Phase::Cancelling);
        let admission =
            self.admission.subscribe().wait_for(|state| *state != Admission::Pending).await.map(|state| state.clone());
        if !matches!(admission, Ok(Admission::Admitted(_))) {
            return Ok(());
        }
        let client = &self.input.client;
        let session = SessionID(self.input.session_id.clone());
        if !self.promoted.get() {
            let input = SessionInboxCancelInput {
                session_id: session.clone(),
                inbox_id: SessionMessageID(self.message_id.clone()),
            };
            let _ = client.session_inbox_cancel(&input).await;
        }
        let running = self.background().await.ok().flatten().unwrap_or_default();
        let directory = self.input.directory.clone();
        tokio::join!(
            interrupt(client, &session.0),
            join_all(running.iter().map(|job| {
                let directory = directory.clone();
                async move {
                    match text(&job["kind"]) {
                        "shell" => {
                            let input = ShellRemoveInput {
                                id: ShellID(text(&job["shellID"]).to_owned()),
                                location: Some(LocationQueryInput { directory: Some(directory) }),
                            };
                            let _ = client.shell_remove(&input).await;
                        }
                        "subagent" => interrupt(client, text(&job["childSessionID"])).await,
                        _ => {}
                    }
                }
            })),
        );
        loop {
            let mark = self.ended_mark();
            self.session_wait().await?;
            let pending = self.background().await?;
            // Image jobs can't be cancelled through the API, so waiting on them would only hold the exit.
            match pending {
                None => return Ok(()),
                Some(pending) if !pending.is_empty() && pending.iter().all(|job| job["kind"] == "image") => {
                    return Ok(());
                }
                Some(_) => {}
            }
            self.ended_since(mark).await?;
        }
    }

    async fn consume(self: Rc<Self>, mut stream: Events) -> Result<(), String> {
        loop {
            let event = match stream.next().await {
                Some(Ok(event)) => event,
                Some(Err(error)) => return Err(error.error_message()),
                None => return Err("Event stream disconnected during prompt execution".into()),
            };
            let kind = text(&event["type"]);
            let data = &event["data"];
            if kind == "permission.asked" {
                if self.owns(text(&data["sessionID"])).await {
                    self.reply_permission(data).await;
                }
                continue;
            }
            if kind == "form.created" {
                if self.owns_form(&data["form"], event.get("location")).await {
                    self.cancel_form(&data["form"]).await?;
                }
                continue;
            }
            let Some(session) = data.get("sessionID") else { continue };
            let session = text(session);
            let terminal = terminal_outcome(&event);
            if self.job_sessions.borrow().iter().any(|known| known == session) {
                if kind == "session.execution.started" && self.phase.get() == Phase::Cancelling {
                    let client = self.input.client.clone();
                    let session = session.to_owned();
                    tokio::task::spawn_local(async move { interrupt(&client, &session).await });
                }
                if terminal.is_some() {
                    self.ended.send_modify(|ended| {
                        if let Ok(count) = ended {
                            *count += 1;
                        }
                    });
                }
            }
            if session != self.input.session_id {
                continue;
            }
            if kind == "session.inbox.delivered" && text(&data["inboxID"]) == self.message_id {
                self.promoted.set(true);
            }
            if let Some(terminal) = terminal {
                // A busy period that ends before this prompt is delivered leaves the prompt queued for good.
                if !self.promoted.get() && terminal.error.is_some() && self.failure.borrow().is_none() {
                    *self.failure.borrow_mut() = terminal.error.clone();
                }
                if self.promoted.get() {
                    self.outcomes.borrow_mut().push(terminal);
                }
            }
            if self.promoted.get() && self.phase.get() == Phase::Running {
                self.render.event(&event);
            }
        }
    }

    fn ended_mark(&self) -> u64 {
        self.ended.borrow().as_ref().map_or(0, |count| *count)
    }

    /// Waits for an execution in a job session to end after `mark`.
    async fn ended_since(&self, mark: u64) -> Result<(), String> {
        let mut receiver = self.ended.subscribe();
        let ended = receiver.wait_for(|ended| ended.as_ref().map_or(true, |count| *count != mark)).await;
        match ended {
            Ok(ended) => ended.clone().map(drop),
            Err(_) => Ok(()),
        }
    }

    async fn session_wait(&self) -> Result<(), String> {
        self.input
            .client
            .experimental_session_wait(&ExperimentalSessionWaitInput {
                session_id: SessionID(self.input.session_id.clone()),
            })
            .await
            .map_err(|error| error.error_message())
    }

    /// The jobs this prompt started (older ones belong to someone else), or `[]` while one of their wakes is
    /// queued or running. Work moves job → inbox → active, so reading in that order can't miss it.
    async fn background(&self) -> Result<Option<Vec<Value>>, String> {
        let Admission::Admitted(since) = *self.admission.borrow() else { return Ok(None) };
        let input = ExperimentalJobListInput {
            session_id: Some(SessionID(self.input.session_id.clone())),
            descendants: Some(true),
            ..Default::default()
        };
        let jobs = match self.data(Client::experimental_job_list_call(&input)).await {
            Ok(jobs) => jobs,
            // Servers older than the job list endpoint answer 404 with no JSON body; they have no jobs to report.
            Err(ApiError::UnsupportedContentType(_)) => json!([]),
            Err(error) => return Err(error.error_message()),
        };
        let running: Vec<Value> = array(&jobs)
            .iter()
            .filter(|job| job["time"]["started"].as_f64().is_some_and(|started| started >= since))
            .cloned()
            .collect();
        for job in &running {
            self.add_job_session(text(&job["sessionID"]));
            if job["kind"] == "subagent" {
                self.add_job_session(text(&job["childSessionID"]));
            }
        }
        if !running.is_empty() {
            return Ok(Some(running));
        }
        let sessions = self.job_sessions.borrow().clone();
        let inboxes = join_all(sessions.iter().map(|session| {
            self.data(Client::session_inbox_list_call(&SessionInboxListInput { session_id: session.as_str().into() }))
        }))
        .await;
        for inbox in inboxes {
            if !array(&inbox.map_err(|error| error.error_message())?).is_empty() {
                return Ok(Some(running));
            }
        }
        let active = self.data(Client::session_active_call()).await.map_err(|error| error.error_message())?;
        for session in active.as_object().into_iter().flat_map(|active| active.keys()) {
            if self.owns(session).await {
                return Ok(Some(running));
            }
        }
        Ok(None)
    }

    fn add_job_session(&self, session: &str) {
        let mut sessions = self.job_sessions.borrow_mut();
        if !sessions.iter().any(|known| known == session) {
            sessions.push(session.to_owned());
        }
    }

    fn owns<'a>(&'a self, session: &'a str) -> std::pin::Pin<Box<dyn Future<Output = bool> + 'a>> {
        Box::pin(async move {
            if let Some(known) = self.owned.borrow().get(session) {
                return *known;
            }
            let result =
                match self.data(Client::session_get_call(&SessionGetInput { session_id: session.into() })).await {
                    Ok(info) => match info["parentID"].as_str() {
                        Some(parent) if !parent.is_empty() => self.owns(parent).await,
                        _ => false,
                    },
                    Err(_) => false,
                };
            self.owned.borrow_mut().insert(session.to_owned(), result);
            result
        })
    }

    // MCP elicitations belong to the "global" sentinel rather than a session; on a shared server they may
    // belong to another client.
    async fn owns_form(&self, form: &Value, location: Option<&Value>) -> bool {
        if form["sessionID"] == "global" {
            return self.owns_global_form(form, location);
        }
        self.owns(text(&form["sessionID"])).await
    }

    fn owns_global_form(&self, form: &Value, location: Option<&Value>) -> bool {
        form["sessionID"] == "global"
            && self.input.standalone
            && location.is_some_and(|location| text(&location["directory"]) == self.input.directory)
    }

    /// Nobody can approve here: reject with feedback so the tool fails as ordinary model-visible output, or
    /// approve once with `--auto`.
    async fn reply_permission(&self, request: &Value) {
        let auto = self.input.auto;
        if !auto {
            let resources =
                request["resources"].as_array().into_iter().flatten().map(text).collect::<Vec<_>>().join(", ");
            ui::println(&[
                &format!("{}!", ui::TEXT_WARNING_BOLD),
                &format!(
                    "{}permission requested: {} ({}); auto-rejecting",
                    ui::TEXT_NORMAL,
                    terminal_text(text(&request["action"])),
                    terminal_text(&resources)
                ),
            ]);
        }
        let _ = self
            .input
            .client
            .permission_reply(&PermissionReplyInput {
                session_id: SessionID(text(&request["sessionID"]).to_owned()),
                request_id: PermissionID(text(&request["id"]).to_owned()),
                decision: if auto { PermissionReply::Once } else { PermissionReply::Reject },
                message: (!auto).then(|| PERMISSION_REJECTED_FEEDBACK.to_owned()),
            })
            .await;
    }

    /// A cancelled question lets the model continue; any other input request fails the run.
    async fn cancel_form(&self, form: &Value) -> Result<(), String> {
        let question = form["metadata"]["kind"] == "question";
        let session = text(&form["sessionID"]);
        let call = async {
            let mut call = Client::session_form_cancel_call(&SessionFormCancelInput {
                session_id: session.to_owned(),
                form_id: FormID(text(&form["id"]).to_owned()),
                message: question.then(|| QUESTION_CANCELLED_FEEDBACK.to_owned()),
            })?;
            // A global form is found through its location.
            if session == "global" {
                call.header("x-opencode-directory", &opencode_api::client::path_param(&self.input.directory)?)?;
            }
            self.input.client.empty(call).await
        };
        if let Err(error) = call.await {
            let settled =
                error.declared().is_some_and(|declared| declared.tag.as_deref() == Some("FormAlreadySettledError"));
            if !settled {
                return Err(error.error_message());
            }
        }
        if !question && self.failure.borrow().is_none() {
            // `${form.title}`.
            let title = form.get("title").map_or("undefined", text);
            *self.failure.borrow_mut() = Some(json!({
                "type": "unknown",
                "message": format!("Cancelled a request for input this run cannot answer: {title}"),
            }));
        }
        Ok(())
    }

    /// The messages after this run's prompt, oldest first, and whether the prompt was found.
    async fn projected_messages(&self) -> Result<(bool, Vec<Value>), String> {
        let mut messages = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let input = MessageListInput {
                session_id: SessionID(self.input.session_id.clone()),
                limit: Some(200),
                order: cursor.is_none().then_some(MessageListInputOrder::Desc),
                cursor: cursor.clone(),
                r#type: None,
            };
            let page = async { self.input.client.json::<Value>(Client::message_list_call(&input)?).await }
                .await
                .map_err(|error| error.error_message())?;
            for message in array(&page["data"]) {
                if text(&message["id"]) == self.message_id {
                    messages.reverse();
                    return Ok((true, messages));
                }
                messages.push(message.clone());
            }
            match page["cursor"]["next"].as_str().filter(|next| !next.is_empty()) {
                Some(next) => cursor = Some(next.to_owned()),
                None => return Ok((false, Vec::new())),
            }
        }
    }

    /// The response to `call` and its `data`, as the TS Promise client unwraps it.
    async fn data(&self, call: Result<Call, ApiError>) -> Result<Value, ApiError> {
        let mut value: Value = self.input.client.json(call?).await?;
        Ok(value.get_mut("data").map(Value::take).unwrap_or(Value::Null))
    }
}

/// The run's exit code comes from here alone: the first stored idle marker after this run's prompt.
fn final_error(run: &Settled, failure: Option<Value>, outcomes: &[Outcome]) -> Option<Value> {
    if let Some(failure) = failure {
        return Some(failure);
    }
    if !run.found {
        return Some(json!({ "type": "unknown", "message": "Prompt was not promoted" }));
    }
    let idles: Vec<Outcome> = run
        .messages
        .iter()
        .filter(|message| message["type"] == "idle")
        .map(|message| Outcome {
            id: text(&message["id"]).to_owned(),
            outcome: text(&message["outcome"]).to_owned(),
            error: present(message.get("error")),
        })
        .collect();
    let recorded = if idles.is_empty() { outcomes.to_vec() } else { idles };
    // The first marker closes this prompt's turn. Later ones count only as replies woken by this prompt's
    // background jobs; otherwise they belong to other prompts, possibly from another client.
    let turns = if run.background { &recorded[..] } else { &recorded[..recorded.len().min(1)] };
    let Some(last) = turns.iter().find(|turn| turn.outcome != "succeeded").or(turns.first()) else {
        return Some(json!({ "type": "unknown", "message": "Session ended without a recorded outcome" }));
    };
    if last.outcome == "succeeded" {
        return None;
    }
    let fallback = json!({
        "type": if last.outcome == "failed" { "unknown" } else { "aborted" },
        "message": format!("Session {}", last.outcome),
    });
    last.error
        .clone()
        .or_else(|| outcomes.iter().find(|turn| turn.id == last.id).and_then(|turn| turn.error.clone()))
        .or(Some(fallback))
}

async fn interrupt(client: &Client, session: &str) {
    let _ = opencode_mini::replay::interrupt(client, session, None).await;
}

fn terminal_outcome(event: &Value) -> Option<Outcome> {
    let event_id = text(&event["id"]);
    let id = match event_id.strip_prefix("evt_") {
        Some(rest) => format!("msg_{rest}"),
        None => event_id.to_owned(),
    };
    let data = &event["data"];
    let (outcome, error) = match text(&event["type"]) {
        "session.execution.succeeded" => ("succeeded", None),
        "session.execution.failed" => ("failed", present(data.get("error"))),
        "session.execution.interrupted" => (
            "interrupted",
            Some(json!({
                "type": "aborted",
                "message": format!("Session interrupted: {}", js_string(&data["reason"])),
            })),
        ),
        _ => return None,
    };
    Some(Outcome { id, outcome: outcome.to_owned(), error })
}

struct Tool {
    id: String,
    timestamp: Value,
    name: String,
    input: Value,
    raw: Option<String>,
    call: Option<Value>,
    metadata: Value,
}

struct Renderer {
    session_id: String,
    directory: String,
    json: bool,
    thinking: bool,
    starts: RefCell<HashMap<String, (String, Value)>>,
    tools: RefCell<HashMap<String, Tool>>,
    // Steps seen: false when started, true when ended.
    steps: RefCell<HashMap<String, bool>>,
    // The session can go idle before the last live events arrive; reconcile prints what they missed.
    printed: RefCell<HashMap<String, String>>,
}

struct Text<'a> {
    kind: &'a str,
    id: String,
    message_id: &'a str,
    ordinal: String,
    text: &'a str,
    metadata: Option<Value>,
}

impl Renderer {
    fn emit(&self, kind: &str, timestamp: &Value, data: Value) -> bool {
        if !self.json {
            return false;
        }
        let line = json_object! { "type": kind, "timestamp": timestamp, "sessionID": self.session_id, ..data };
        let _ = crate::output::print(&(line.to_string() + "\n"));
        true
    }

    fn block(&self, line: &str) {
        ui::empty();
        ui::println(&[line]);
        ui::empty();
    }

    fn text(&self, part: Text, start: &Value, end: &Value) {
        if part.kind == "reasoning" && !self.thinking {
            return;
        }
        let id = key(&[part.kind, part.message_id, &part.ordinal]);
        let previous = self.printed.borrow().get(&id).cloned();
        if previous.as_ref().is_some_and(|previous| previous == part.text || !part.text.starts_with(previous)) {
            return;
        }
        self.printed.borrow_mut().insert(id, part.text.to_owned());
        let value = &part.text[previous.map_or(0, |previous| previous.len())..];
        let json = json_object! { "id": part.id, "sessionID": self.session_id, "messageID": part.message_id, "type": part.kind, "text": value, "metadata"?: part.metadata.filter(|_| part.kind == "reasoning"), "time": json!({ "start": start, "end": end }) };
        if self.emit(part.kind, end, json!({ "part": json })) {
            return;
        }
        let value = terminal_text(value);
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return;
        }
        let line = if part.kind == "text" { trimmed.to_owned() } else { format!("Thinking: {trimmed}") };
        if !std::io::stdout().is_terminal() {
            let _ = crate::output::print(&format!("{line}\n"));
            return;
        }
        if part.kind == "text" {
            return self.block(&line);
        }
        self.block(&format!("{}\x1b[3m{line}\x1b[0m{}", ui::TEXT_DIM, ui::TEXT_NORMAL));
    }

    /// `item` is a `SessionMessageAssistantTool` whose state is completed or error.
    fn tool(&self, part_id: String, message_id: &str, item: &Value, metadata: Value, timestamp: &Value) {
        let id = key(&[message_id, text(&item["id"])]);
        if self.printed.borrow().contains_key(&id) {
            return;
        }
        self.printed.borrow_mut().insert(id, String::new());
        let name = text(&item["name"]);
        let state = &item["state"];
        let time = json!({
            "start": or(&item["time"]["ran"], &item["time"]["created"]),
            "end": or(&item["time"]["completed"], timestamp),
        });
        let completed = state["status"] == "completed";
        let projected = if completed {
            json_object! { "status": "completed", "input"?: state.get("input"), "output": output_text(name, state.get("content")), "title": name, "metadata": metadata, "time": time }
        } else {
            json_object! { "status": "error", "input"?: state.get("input"), "error"?: state["error"].get("message"), "metadata": metadata, "time": time }
        };
        let part = json_object! { "partID": part_id, "sessionID": self.session_id, "messageID": message_id, "type": "tool", "id"?: item.get("id"), "tool": name, "state": projected };
        if self.emit("tool_use", timestamp, json!({ "part": part })) {
            return;
        }
        if completed {
            return self.render_tool(item);
        }
        if truthy(&state["content"]) && !output_text(name, state.get("content")).trim().is_empty() {
            let mut shown = item.clone();
            shown["state"] = json_object! { "status": "completed", "input"?: state.get("input"), "metadata"?: state.get("metadata"), "content"?: state.get("content") };
            self.render_tool(&shown);
        }
        if let Some(info) = inline(item, &self.directory) {
            ui::println(&[&format!("{}✗", ui::TEXT_NORMAL), &format!("{}{} failed", ui::TEXT_NORMAL, info.title)]);
        }
        ui::error(text(&state["error"]["message"]));
    }

    fn step(&self, kind: &str, timestamp: &Value, id: String, message_id: &str, rest: Value) -> bool {
        self.steps.borrow_mut().insert(message_id.to_owned(), kind == "step-finish");
        let part =
            json_object! { "id": id, "sessionID": self.session_id, "messageID": message_id, "type": kind, ..rest };
        let name = if kind == "step-start" { "step_start" } else { "step_finish" };
        self.emit(name, timestamp, json!({ "part": part }))
    }

    fn error(&self, error: &Value) {
        if !self.emit("error", &now(), json!({ "error": error })) {
            ui::error(text(&error["message"]));
        }
    }

    fn waiting(&self, jobs: &[Value]) {
        let list: Vec<Value> = jobs
            .iter()
            .map(|job| {
                json_object! { "id"?: job.get("id"), "kind"?: job.get("kind"), "title"?: job.get("title") }
            })
            .collect();
        if self.emit("background_wait", &now(), json!({ "jobs": list })) {
            return;
        }
        let plural = if jobs.len() == 1 { "" } else { "s" };
        ui::println(&[&format!(
            "{}waiting for {} background job{plural}{}",
            ui::TEXT_DIM,
            jobs.len(),
            ui::TEXT_NORMAL
        )]);
    }

    fn event(&self, event: &Value) {
        let kind = text(&event["type"]);
        let data = &event["data"];
        let time = event_time(event);
        let message = text(&data["assistantMessageID"]);
        match kind {
            "session.retry.scheduled" => {
                let retry = json_object! { "messageID"?: data.get("assistantMessageID"), "attempt"?: data.get("attempt"), "nextRetryAt"?: data.get("at"), "error"?: data.get("error") };
                if self.emit("retry", &time, retry) {
                    return;
                }
                ui::println(&[
                    &format!("{}!", ui::TEXT_WARNING_BOLD),
                    &format!(
                        "{}retrying (attempt {}): {}",
                        ui::TEXT_NORMAL,
                        terminal_text(&js_string(&data["attempt"])),
                        terminal_text(text(&data["error"]["message"]))
                    ),
                ]);
            }
            // Each retried attempt of a step starts it again.
            "session.step.started" if !self.steps.borrow().contains_key(message) => {
                let rest = json_object! { "snapshot"?: data.get("snapshot") };
                if !self.step("step-start", &time, part_id(text(&event["id"])), message, rest) {
                    let (agent, model) = (text(&data["agent"]), text(&data["model"]["id"]));
                    self.block(&format!("> {} · {}", terminal_text(agent), terminal_text(model)));
                }
            }
            "session.step.ended" => {
                let rest = json_object! { "reason"?: data.get("finish"), "snapshot"?: data.get("snapshot"), "cost"?: data.get("cost"), "tokens"?: data.get("tokens") };
                self.step("step-finish", &time, part_id(text(&event["id"])), message, rest);
            }
            "session.text.started" | "session.reasoning.started" => {
                let kind = if kind == "session.text.started" { "text" } else { "reasoning" };
                self.starts
                    .borrow_mut()
                    .insert(key(&[kind, message, &js_string(&data["ordinal"])]), (part_id(text(&event["id"])), time));
            }
            "session.text.ended" | "session.reasoning.ended" => {
                let kind = if kind == "session.text.ended" { "text" } else { "reasoning" };
                let ordinal = js_string(&data["ordinal"]);
                let started = self.starts.borrow().get(&key(&[kind, message, &ordinal])).cloned();
                let (id, start) = started.unwrap_or_else(|| (part_id(text(&event["id"])), time.clone()));
                let metadata = if kind == "reasoning" { data.get("native").cloned() } else { None };
                let part = Text { kind, id, message_id: message, ordinal, text: text(&data["text"]), metadata };
                self.text(part, &start, &time);
            }
            "session.tool.input.started" | "session.tool.called" => {
                let id = key(&[message, text(&data["id"])]);
                let mut tools = self.tools.borrow_mut();
                let current = tools.remove(&id);
                let called = kind == "session.tool.called";
                let tool = Tool {
                    id: current.as_ref().map_or_else(|| part_id(text(&event["id"])), |current| current.id.clone()),
                    timestamp: current.as_ref().map_or(time, |current| current.timestamp.clone()),
                    name: match (called, &current) {
                        (false, _) => text(&data["name"]).to_owned(),
                        (true, Some(current)) => current.name.clone(),
                        (true, None) => "tool".to_owned(),
                    },
                    input: if called { data["input"].clone() } else { json!({}) },
                    raw: current.and_then(|current| current.raw),
                    call: called.then(|| {
                        json_object! { "executed"?: data.get("executed"), "state"?: data.get("native") }
                    }),
                    metadata: json!({}),
                };
                tools.insert(id, tool);
            }
            "session.tool.input.delta" | "session.tool.input.ended" | "session.tool.progress" => {
                let mut tools = self.tools.borrow_mut();
                let Some(current) = tools.get_mut(&key(&[message, text(&data["id"])])) else { return };
                match kind {
                    "session.tool.input.delta" => {
                        current.raw = Some(current.raw.take().unwrap_or_default() + text(&data["delta"]));
                    }
                    "session.tool.input.ended" => current.raw = Some(text(&data["text"]).to_owned()),
                    _ => current.metadata = data["metadata"].clone(),
                }
            }
            "session.tool.success" | "session.tool.failed" => self.tool_ended(event, message, time),
            _ => {}
        }
    }

    fn tool_ended(&self, event: &Value, message: &str, time: Value) {
        let data = &event["data"];
        let current = self.tools.borrow_mut().remove(&key(&[message, text(&data["id"])])).unwrap_or(Tool {
            id: part_id(text(&event["id"])),
            timestamp: time.clone(),
            name: "tool".to_owned(),
            input: json!({}),
            raw: None,
            call: None,
            metadata: json!({}),
        });
        let call_state = current.call.as_ref().and_then(|call| call.get("state")).cloned();
        let call = json_object! { "providerCall"?: &current.call, "providerResult": json_object! { "executed"?: data.get("executed"), "state"?: data.get("native") }, "rawInput"?: &current.raw };
        let native = if truthy(&data["native"]) {
            Some(json_object! { ..call_state.unwrap_or_default(), ..data["native"].clone() })
        } else {
            call_state
        };
        let success = text(&event["type"]) == "session.tool.success";
        let (state, metadata) = if success {
            let state = json_object! { "status": "completed", "input": current.input, "metadata"?: data.get("metadata"), "content"?: data.get("content") };
            let metadata = json_object! { "metadata"?: data.get("metadata"), "content"?: data.get("content"), ..call };
            (state, metadata)
        } else {
            let state = json_object! { "status": "error", "input": current.input, "metadata": present(data.get("metadata")).unwrap_or(current.metadata.clone()), "content"?: data.get("content"), "error"?: data.get("error") };
            (state, call)
        };
        let item = json_object! { "type": "tool", "id"?: data.get("id"), "name": current.name, "executed"?: data.get("executed"), "native"?: native, "time": json!({ "created": current.timestamp, "ran": current.timestamp, "completed": time }), "state": state };
        self.tool(current.id, message, &item, metadata, &time);
    }

    fn reconcile(&self, messages: &[Value]) {
        for message in messages.iter().filter(|message| message["type"] == "assistant") {
            let message_id = text(&message["id"]);
            let created = &message["time"]["created"];
            let timestamp = or(&message["time"]["completed"], created);
            let seen = self.steps.borrow().get(message_id).copied();
            let id = |part: &str| format!("prt_{}_{part}", message_id.strip_prefix("msg_").unwrap_or(message_id));
            if seen.is_none() {
                let rest = json_object! { "snapshot"?: message["snapshot"].get("start") };
                self.step("step-start", created, id("step-start"), message_id, rest);
            }
            let (mut texts, mut reasonings) = (0u64, 0u64);
            for item in array(&message["content"]) {
                let kind = text(&item["type"]);
                if kind == "tool" {
                    let status = text(&item["state"]["status"]);
                    if status == "streaming" || status == "running" {
                        continue;
                    }
                    let state = &item["state"];
                    let metadata =
                        json_object! { "metadata"?: state.get("metadata"), "content"?: state.get("content") };
                    self.tool(id(&format!("tool-{}", text(&item["id"]))), message_id, item, metadata, &timestamp);
                    continue;
                }
                let counter = match kind {
                    "text" => &mut texts,
                    "reasoning" => &mut reasonings,
                    _ => continue,
                };
                let ordinal = counter.to_string();
                *counter += 1;
                let body = text(&item["text"]);
                // A part never printed live and still empty has nothing to show.
                if body.is_empty() && !self.printed.borrow().contains_key(&key(&[kind, message_id, &ordinal])) {
                    continue;
                }
                let metadata = if kind == "reasoning" { item.get("native").cloned() } else { None };
                let part =
                    Text { kind, id: id(&format!("{kind}-{ordinal}")), message_id, ordinal, text: body, metadata };
                self.text(part, created, &timestamp);
            }
            if seen != Some(true) && truthy(&message["finish"]) && truthy(&message["tokens"]) {
                let rest = json_object! { "reason"?: message.get("finish"), "snapshot"?: message["snapshot"].get("end"), "cost": or(&message["cost"], &Value::from(0)), "tokens"?: message.get("tokens") };
                self.step("step-finish", &timestamp, id("step-finish"), message_id, rest);
            }
        }
    }

    fn render_tool(&self, part: &Value) {
        let Some(info) = inline(part, &self.directory) else { return };
        if info.block {
            ui::empty();
            ui::println(&[&format!("{}{}", ui::TEXT_NORMAL, info.icon), &format!("{}{}", ui::TEXT_NORMAL, info.title)]);
            if let Some(body) = info.body.filter(|body| !body.trim().is_empty()) {
                ui::println(&[&body]);
            }
            ui::empty();
            return;
        }
        let description = info
            .description
            .filter(|description| !description.is_empty())
            .map(|description| format!("{}{description}{}", ui::TEXT_DIM, ui::TEXT_NORMAL))
            .unwrap_or_default();
        ui::println(&[
            &format!("{}{}", ui::TEXT_NORMAL, info.icon),
            &format!("{}{}", ui::TEXT_NORMAL, info.title),
            &description,
        ]);
    }
}

/// `toolInlineInfo` over the JSON part, its text without control characters. The generated type needs `metadata`
/// and `content`, which the TS summary reads as optional.
fn inline(part: &Value, directory: &str) -> Option<opencode_ui::tool_info::ToolInline> {
    let mut part = part.clone();
    if let Some(state) = part["state"].as_object_mut() {
        state.entry("metadata").or_insert_with(|| json!({}));
        if state.get("content").is_none_or(Value::is_null) {
            state.insert("content".into(), json!([]));
        }
    }
    match serde_json::from_value::<SessionMessageAssistantTool>(part) {
        Ok(tool) => {
            let mut info = tool_inline_info(&tool, Some(directory));
            for text in [Some(&mut info.title), info.description.as_mut(), info.body.as_mut()].into_iter().flatten() {
                *text = terminal_text(text).into_owned();
            }
            Some(info)
        }
        Err(error) => {
            log::warn!("run: cannot summarize a tool part: {error}");
            None
        }
    }
}

fn output_text(name: &str, content: Option<&Value>) -> String {
    let content: Vec<ToolContent> =
        content.and_then(|content| serde_json::from_value(content.clone()).ok()).unwrap_or_default();
    tool_output_text(name, &content)
}

fn array(value: &Value) -> &[Value] {
    value.as_array().map_or(&[], Vec::as_slice)
}

fn text(value: &Value) -> &str {
    value.as_str().unwrap_or_default()
}

/// `${value}` for the strings and numbers events carry.
fn js_string(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Null => "undefined".to_owned(),
        value => value.to_string(),
    }
}

/// `a ?? b`.
fn or(a: &Value, b: &Value) -> Value {
    if a.is_null() { b.clone() } else { a.clone() }
}

/// A field that is neither missing nor null.
fn present(value: Option<&Value>) -> Option<Value> {
    value.filter(|value| !value.is_null()).cloned()
}

fn truthy(value: &Value) -> bool {
    match value {
        Value::Null | Value::Bool(false) => false,
        Value::String(value) => !value.is_empty(),
        Value::Number(number) => number.as_f64().is_some_and(|number| number != 0.0),
        _ => true,
    }
}

fn event_time(event: &Value) -> Value {
    match event.get("created") {
        Some(created) => created.clone(),
        None => now(),
    }
}

fn now() -> Value {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64);
    Value::from(millis)
}

fn key(parts: &[&str]) -> String {
    parts.join("\0")
}

fn part_id(event_id: &str) -> String {
    format!("prt_{}", event_id.strip_prefix("evt_").unwrap_or(event_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn idle(id: &str, outcome: &str, error: Option<Value>) -> Value {
        json_object! { "id": id, "type": "idle", "outcome": outcome, "error"?: error }
    }

    fn settled(messages: Vec<Value>, background: bool) -> Settled {
        Settled { found: true, messages, background }
    }

    fn outcome(id: &str, outcome: &str, error: Option<Value>) -> Outcome {
        Outcome { id: id.into(), outcome: outcome.into(), error }
    }

    #[test]
    fn only_the_first_idle_marker_decides_unless_background_work_woke_more() {
        let failed = json!({ "type": "provider.transport", "message": "Execution failed" });
        let messages = vec![
            json!({ "id": "msg_assistant", "type": "assistant" }),
            idle("msg_idle", "succeeded", None),
            json!({ "id": "msg_other_prompt", "type": "user" }),
            idle("msg_later_idle", "failed", Some(failed.clone())),
        ];
        assert_eq!(final_error(&settled(messages.clone(), false), None, &[]), None);
        assert_eq!(final_error(&settled(messages, true), None, &[]), Some(failed));
    }

    #[test]
    fn a_missed_live_outcome_comes_from_the_idle_marker_or_the_event() {
        let interrupted = final_error(&settled(vec![idle("msg_1", "interrupted", None)], false), None, &[]);
        assert_eq!(interrupted, Some(json!({ "type": "aborted", "message": "Session interrupted" })));
        let failed = final_error(&settled(vec![idle("msg_1", "failed", None)], false), None, &[]);
        assert_eq!(failed, Some(json!({ "type": "unknown", "message": "Session failed" })));
        let error = json!({ "type": "provider", "message": "rate limited" });
        let live = [outcome("msg_1", "failed", Some(error.clone()))];
        assert_eq!(final_error(&settled(vec![idle("msg_1", "failed", None)], false), None, &live), Some(error.clone()));
        assert_eq!(final_error(&settled(Vec::new(), false), None, &live), Some(error));
    }

    #[test]
    fn failures_and_missing_prompts_win() {
        let failure = json!({ "type": "unknown", "message": "no provider" });
        let run = Settled { found: false, messages: Vec::new(), background: false };
        assert_eq!(final_error(&run, Some(failure.clone()), &[]), Some(failure));
        assert_eq!(
            final_error(&run, None, &[]),
            Some(json!({ "type": "unknown", "message": "Prompt was not promoted" }))
        );
        assert_eq!(
            final_error(&settled(Vec::new(), false), None, &[]),
            Some(json!({ "type": "unknown", "message": "Session ended without a recorded outcome" }))
        );
    }

    #[test]
    fn terminal_events_name_their_idle_marker() {
        let event = json!({ "id": "evt_1", "type": "session.execution.interrupted", "data": { "reason": "user" } });
        let terminal = terminal_outcome(&event).unwrap();
        assert_eq!((terminal.id.as_str(), terminal.outcome.as_str()), ("msg_1", "interrupted"));
        assert_eq!(terminal.error, Some(json!({ "type": "aborted", "message": "Session interrupted: user" })));
        assert!(terminal_outcome(&json!({ "id": "evt_2", "type": "session.step.ended", "data": {} })).is_none());
    }
}
