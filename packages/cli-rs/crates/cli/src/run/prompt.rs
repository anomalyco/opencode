//! The prompt of a non-interactive run (`runNonInteractivePrompt`, `packages/cli/src/run/noninteractive.ts`):
//! subscribe to events, send the prompt, print what the session does, answer permissions and forms nobody
//! can answer, wait until the session and its background work are idle, then print what the event stream
//! missed from the projected messages.
//!
//! Events and messages stay JSON, as the TS client reads them: `--format json` passes their fields through
//! unchanged, unknown ones included.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::io::IsTerminal;
use std::rc::Rc;

use futures_util::StreamExt;
use opencode_api::client::{Call, Client, RequestOptions};
use opencode_api::error::Error as ApiError;
use opencode_api::generated::*;
use opencode_api::transport::SseResponse;
use opencode_ui::tool_info::{tool_inline_info, tool_output_text};
use serde_json::{Map, Value, json};
use tokio::sync::watch;

use super::files::Prepared;
use super::ui;

// MCP elicitations belong to this sentinel instead of a session. `run` is always attached to a shared
// server, so it never answers them.
const GLOBAL_FORM_SESSION_ID: &str = "global";

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
    /// `process.exitCode`.
    pub exit: Rc<Cell<u8>>,
}

#[derive(Default)]
struct Flags {
    submitted: bool,
    promoted: bool,
    emitted_error: bool,
    form_cancelled: bool,
    finalizing: bool,
    waiting_for_background: bool,
    pre_promotion_error: Option<Value>,
}

struct ToolState {
    id: String,
    timestamp: Value,
    tool: String,
    input: Value,
    raw: Option<String>,
    provider: Option<Value>,
    native: Option<Value>,
    metadata: Value,
}

struct Run {
    input: Input,
    message_id: String,
    flags: RefCell<Flags>,
    starts: RefCell<HashMap<String, (String, Value)>>,
    tools: RefCell<HashMap<String, ToolState>>,
    rendered_text: RefCell<HashMap<String, String>>,
    rendered_reasoning: RefCell<HashMap<String, String>>,
    rendered_tools: RefCell<HashSet<String>>,
    // Steps the live stream saw: false when started, true when ended.
    steps: RefCell<HashMap<String, bool>>,
    owned: RefCell<HashMap<String, bool>>,
    job_sessions: RefCell<Vec<String>>,
    abort: watch::Sender<bool>,
    completed: watch::Sender<Option<Result<(), String>>>,
}

enum Flow {
    Next,
    Done,
}

pub async fn run(input: Input) -> Result<(), String> {
    let response = input
        .client
        .event_subscribe(&EventSubscribeInput::default(), &RequestOptions::default())
        .await
        .map_err(|error| error.error_message())?;
    let mut stream = Box::pin(SseResponse::<Value>::new(response.response).events(|| {}));
    if !matches!(stream.next().await, Some(Ok(_))) {
        return Err("Event stream disconnected before prompt admission".into());
    }
    let session_id = input.session_id.clone();
    let run = Rc::new(Run {
        input,
        message_id: opencode_api::id::message(),
        flags: RefCell::default(),
        starts: RefCell::default(),
        tools: RefCell::default(),
        rendered_text: RefCell::default(),
        rendered_reasoning: RefCell::default(),
        rendered_tools: RefCell::default(),
        steps: RefCell::default(),
        owned: RefCell::new(HashMap::from([(session_id.clone(), true)])),
        job_sessions: RefCell::new(vec![session_id]),
        abort: watch::channel(false).0,
        completed: watch::channel(None).0,
    });
    let _teardown = interrupt_on_shutdown(run.input.client.clone(), run.input.session_id.clone());
    let result = run.clone().execute(stream).await;
    run.abort.send_replace(true);
    result
}

impl Run {
    async fn execute(
        self: Rc<Self>,
        stream: std::pin::Pin<Box<impl futures_util::Stream<Item = Result<Value, ApiError>> + 'static>>,
    ) -> Result<(), String> {
        let client = &self.input.client;
        let session = SessionID(self.input.session_id.clone());
        if let Some(agent) = &self.input.agent {
            client
                .session_switch_agent(
                    &SessionSwitchAgentInput { session_id: session.clone(), agent: AgentID(agent.clone()) },
                    &RequestOptions::default(),
                )
                .await
                .map_err(|error| error.error_message())?;
        }
        if let Some(model) = &self.input.model {
            // The TS key order, `{ providerID, id, variant }`; the generated `ModelRef` puts `id` first.
            let mut call = Call::new(
                "POST",
                format!("/api/session/{}/model", path(&self.input.session_id)),
                204,
                &[400, 401, 404],
            );
            call.json(&json!({ "model": object([
                ("providerID", Some(model.provider_id.0.clone().into())),
                ("id", Some(model.id.clone().into())),
                ("variant", model.variant.clone().map(Value::from)),
            ]) }))
            .map_err(|error| error.error_message())?;
            client.empty(call, &RequestOptions::default()).await.map_err(|error| error.error_message())?;
        }
        self.flags.borrow_mut().submitted = true;
        tokio::task::spawn_local({
            let run = self.clone();
            async move {
                let result = run.clone().consume(stream).await;
                run.completed.send_replace(Some(result));
            }
        });
        let text = std::iter::once(self.input.message.as_str())
            .chain(self.input.files.iter().filter_map(|file| match file {
                Prepared::Text(text) => Some(text.as_str()),
                Prepared::Attachment { .. } => None,
            }))
            .collect::<Vec<_>>()
            .join("\n\n");
        let files: Vec<Value> = self
            .input
            .files
            .iter()
            .filter_map(|file| match file {
                Prepared::Attachment { uri, name } => Some(json!({ "uri": uri, "name": name })),
                Prepared::Text(_) => None,
            })
            .collect();
        let mut call = Call::new(
            "POST",
            format!("/api/session/{}/prompt", path(&self.input.session_id)),
            200,
            &[400, 401, 404, 409],
        );
        call.json(&json!({
            "id": self.message_id,
            "text": text,
            "files": files,
            "delivery": "steer",
        }))
        .map_err(|error| error.error_message())?;
        let admitted =
            client.json::<Value>(call, &RequestOptions::default()).await.map_err(|error| error.error_message());
        if let Err(error) = admitted {
            self.abort.send_replace(true);
            let _ = self.wait_completed().await;
            if self.flags.borrow().emitted_error {
                return Ok(());
            }
            return Err(error);
        }

        let permissions =
            self.data(&format!("/api/session/{}/permission", path(&self.input.session_id)), &[]).await.ok();
        let forms = self.data(&format!("/api/session/{}/form", path(&self.input.session_id)), &[]).await.ok();
        for permission in array(permissions.as_ref()) {
            self.reply_permission(permission).await;
        }
        for form in array(forms.as_ref()) {
            self.cancel_form(form).await?;
        }

        // `Promise.race([waiting, completed.then(() => waiting)])`: the wait, unless the event loop fails first.
        let waiting = self.wait_until_idle();
        tokio::pin!(waiting);
        tokio::select! {
            result = &mut waiting => result?,
            Err(error) = self.wait_completed() => return Err(error),
        }
        self.flags.borrow_mut().finalizing = true;
        let (found, responded) = self.reconcile().await?;
        let wait_for_stream = {
            let flags = self.flags.borrow();
            !responded && settled_flags(&flags) && flags.pre_promotion_error.is_none()
        };
        if wait_for_stream {
            self.wait_completed().await?;
        }
        if !found && settled_flags(&self.flags.borrow()) {
            let error = self
                .flags
                .borrow()
                .pre_promotion_error
                .clone()
                .unwrap_or_else(|| json!({ "type": "unknown", "message": "Prompt was not promoted" }));
            self.fail(&error, &now());
        }
        Ok(())
    }

    async fn wait_until_idle(&self) -> Result<(), String> {
        self.session_wait().await?;
        if !self.pending_background().await {
            return Ok(());
        }
        self.wait_completed().await?;
        let more = settled_flags(&self.flags.borrow());
        if more {
            self.session_wait().await?;
        }
        Ok(())
    }

    async fn session_wait(&self) -> Result<(), String> {
        self.input
            .client
            .experimental_session_wait(
                &ExperimentalSessionWaitInput { session_id: SessionID(self.input.session_id.clone()) },
                &RequestOptions::default(),
            )
            .await
            .map_err(|error| error.error_message())
    }

    async fn wait_completed(&self) -> Result<(), String> {
        let mut receiver = self.completed.subscribe();
        let done = receiver.wait_for(Option::is_some).await;
        match done {
            Ok(value) => value.clone().unwrap_or(Ok(())),
            Err(_) => Ok(()),
        }
    }

    async fn consume(
        self: Rc<Self>,
        mut stream: std::pin::Pin<Box<impl futures_util::Stream<Item = Result<Value, ApiError>>>>,
    ) -> Result<(), String> {
        let mut abort = self.abort.subscribe();
        loop {
            let next = tokio::select! {
                next = stream.next() => next,
                _ = abort.wait_for(|aborted| *aborted) => None,
            };
            let event = match next {
                Some(Ok(event)) => event,
                Some(Err(error)) => {
                    if !self.flags.borrow().emitted_error {
                        return Err(error.error_message());
                    }
                    return Ok(());
                }
                None => {
                    if self.flags.borrow().emitted_error {
                        return Ok(());
                    }
                    return Err("Event stream disconnected during prompt execution".into());
                }
            };
            if let Flow::Done = self.handle(&event).await? {
                return Ok(());
            }
        }
    }

    async fn handle(&self, event: &Value) -> Result<Flow, String> {
        let kind = event["type"].as_str().unwrap_or_default();
        let data = &event["data"];
        let submitted = self.flags.borrow().submitted;
        if kind == "permission.asked" && submitted && self.owns(text(&data["sessionID"])).await {
            self.reply_permission(data).await;
            return Ok(Flow::Next);
        }
        if kind == "form.created" && submitted && self.owns(text(&data["form"]["sessionID"])).await {
            self.cancel_form(&data["form"]).await?;
            return Ok(Flow::Next);
        }
        let Some(session) = data.get("sessionID") else {
            return Ok(Flow::Next);
        };
        if text(session) != self.input.session_id {
            // While waiting, a reply ending anywhere in the tree may have finished the last of the work.
            if self.flags.borrow().waiting_for_background
                && matches!(
                    kind,
                    "session.execution.succeeded" | "session.execution.failed" | "session.execution.interrupted"
                )
                && self.owns(text(session)).await
                && !self.pending_background().await
            {
                return Ok(Flow::Done);
            }
            return Ok(Flow::Next);
        }
        let time = event_time(event);

        if kind == "session.inbox.delivered" && text(&data["inboxID"]) == self.message_id {
            let mut flags = self.flags.borrow_mut();
            flags.promoted = true;
            flags.pre_promotion_error = None;
            return Ok(Flow::Next);
        }
        {
            let mut flags = self.flags.borrow_mut();
            if kind == "session.execution.interrupted" && data["reason"] == "user" && flags.form_cancelled {
                return Ok(Flow::Done);
            }
            if !flags.promoted && kind == "session.execution.failed" {
                flags.pre_promotion_error = Some(data["error"].clone());
                return Ok(if flags.finalizing { Flow::Done } else { Flow::Next });
            }
            if !flags.promoted
                && flags.finalizing
                && matches!(kind, "session.execution.succeeded" | "session.execution.interrupted")
            {
                return Ok(Flow::Done);
            }
            if !flags.promoted {
                return Ok(Flow::Next);
            }
            if flags.finalizing && !kind.starts_with("session.execution.") {
                return Ok(Flow::Next);
            }
        }
        let message = text(&data["assistantMessageID"]).to_owned();
        let part_id = part_id(text(&event["id"]));

        match kind {
            "session.step.started" => {
                let part = object([
                    ("id", Some(Value::from(part_id))),
                    ("sessionID", Some(self.input.session_id.clone().into())),
                    ("messageID", Some(message.clone().into())),
                    ("type", Some("step-start".into())),
                    ("snapshot", data.get("snapshot").cloned()),
                ]);
                self.steps.borrow_mut().insert(message, false);
                if !self.emit("step_start", &time, [("part", part)]) {
                    ui::empty();
                    ui::println(&[&format!("> {} · {}", text(&data["agent"]), text(&data["model"]["id"]))]);
                    ui::empty();
                }
            }
            "session.text.started" | "session.reasoning.started" => {
                let prefix = kind.split('.').nth(1).unwrap_or_default();
                self.starts
                    .borrow_mut()
                    .insert(format!("{prefix}\0{}", content_key(&message, &data["ordinal"])), (part_id, time));
            }
            "session.text.ended" => {
                let key = content_key(&message, &data["ordinal"]);
                let started = self.starts.borrow_mut().remove(&format!("text\0{key}"));
                let (id, start) = started.unwrap_or((part_id, time.clone()));
                let part = object([
                    ("id", Some(id.into())),
                    ("sessionID", Some(self.input.session_id.clone().into())),
                    ("messageID", Some(message.into())),
                    ("type", Some("text".into())),
                    ("text", Some(data["text"].clone())),
                    ("time", Some(json!({ "start": start, "end": time }))),
                ]);
                self.rendered_text.borrow_mut().insert(key, text(&data["text"]).to_owned());
                self.write_text(part, &time);
            }
            "session.reasoning.ended" if self.input.thinking => {
                let key = content_key(&message, &data["ordinal"]);
                let started = self.starts.borrow_mut().remove(&format!("reasoning\0{key}"));
                let (id, start) = started.unwrap_or((part_id, time.clone()));
                let part = object([
                    ("id", Some(id.into())),
                    ("sessionID", Some(self.input.session_id.clone().into())),
                    ("messageID", Some(message.into())),
                    ("type", Some("reasoning".into())),
                    ("text", Some(data["text"].clone())),
                    ("metadata", data.get("native").cloned()),
                    ("time", Some(json!({ "start": start, "end": time }))),
                ]);
                self.rendered_reasoning.borrow_mut().insert(key, text(&data["text"]).to_owned());
                self.write_reasoning(part, &time);
            }
            "session.tool.input.started" => {
                self.tools.borrow_mut().insert(
                    tool_key(&message, text(&data["id"])),
                    ToolState {
                        id: part_id,
                        timestamp: time,
                        tool: text(&data["name"]).to_owned(),
                        input: json!({}),
                        raw: None,
                        provider: None,
                        native: None,
                        metadata: json!({}),
                    },
                );
            }
            "session.tool.input.ended" | "session.tool.input.delta" => {
                if let Some(current) = self.tools.borrow_mut().get_mut(&tool_key(&message, text(&data["id"]))) {
                    current.raw = Some(if kind.ends_with("ended") {
                        text(&data["text"]).to_owned()
                    } else {
                        current.raw.take().unwrap_or_default() + text(&data["delta"])
                    });
                }
            }
            "session.tool.called" => {
                let key = tool_key(&message, text(&data["id"]));
                let mut tools = self.tools.borrow_mut();
                let current = tools.remove(&key);
                let provider =
                    object([("executed", data.get("executed").cloned()), ("state", data.get("native").cloned())]);
                tools.insert(
                    key,
                    ToolState {
                        id: current.as_ref().map_or(part_id, |current| current.id.clone()),
                        timestamp: current.as_ref().map_or(time, |current| current.timestamp.clone()),
                        tool: current.as_ref().map_or("tool".to_owned(), |current| current.tool.clone()),
                        input: data["input"].clone(),
                        raw: current.and_then(|current| current.raw),
                        provider: Some(provider),
                        native: data.get("native").cloned(),
                        metadata: json!({}),
                    },
                );
            }
            "session.tool.progress" => {
                if let Some(current) = self.tools.borrow_mut().get_mut(&tool_key(&message, text(&data["id"]))) {
                    current.metadata = data["metadata"].clone();
                }
            }
            "session.tool.success" | "session.tool.failed" => {
                self.tool_ended(kind == "session.tool.success", event, &message, part_id, &time).await;
            }
            "session.step.ended" => {
                self.steps.borrow_mut().insert(message.clone(), true);
                let part = object([
                    ("id", Some(part_id.into())),
                    ("sessionID", Some(self.input.session_id.clone().into())),
                    ("messageID", Some(message.into())),
                    ("type", Some("step-finish".into())),
                    ("reason", data.get("finish").cloned()),
                    ("snapshot", data.get("snapshot").cloned()),
                    ("cost", data.get("cost").cloned()),
                    ("tokens", data.get("tokens").cloned()),
                ]);
                self.emit("step_finish", &time, [("part", part)]);
            }
            "session.step.failed" => {
                let quiet = self.flags.borrow().form_cancelled;
                if !quiet {
                    self.fail(&data["error"], &time);
                }
            }
            "session.execution.failed" => {
                let report = {
                    let flags = self.flags.borrow();
                    !flags.emitted_error && !flags.form_cancelled
                };
                if report {
                    self.fail(&data["error"], &time);
                }
                return Ok(Flow::Done);
            }
            "session.execution.interrupted" => {
                let report = {
                    let flags = self.flags.borrow();
                    !flags.emitted_error && !flags.form_cancelled
                };
                let reason = text(&data["reason"]);
                // A declined tool call ends the step with an interruption; it was already reported above.
                if reason != "user" && report {
                    self.fail(
                        &json!({ "type": "aborted", "message": format!("Session interrupted: {reason}") }),
                        &time,
                    );
                }
                return Ok(Flow::Done);
            }
            "session.execution.succeeded" => {
                let waiting = self.pending_background().await;
                self.flags.borrow_mut().waiting_for_background = waiting;
                if !waiting {
                    return Ok(Flow::Done);
                }
            }
            _ => {}
        }
        Ok(Flow::Next)
    }

    async fn tool_ended(&self, success: bool, event: &Value, message: &str, part_id: String, time: &Value) {
        let data = &event["data"];
        let id = text(&data["id"]);
        let key = tool_key(message, id);
        let current = self.tools.borrow_mut().remove(&key).unwrap_or(ToolState {
            id: part_id,
            timestamp: time.clone(),
            tool: "tool".to_owned(),
            input: json!({}),
            raw: None,
            provider: None,
            native: None,
            metadata: json!({}),
        });
        self.rendered_tools.borrow_mut().insert(key);
        let native = match (data.get("native"), &current.native) {
            (Some(Value::Object(next)), Some(Value::Object(previous))) => {
                let mut merged = previous.clone();
                merged.extend(next.clone());
                Some(Value::Object(merged))
            }
            (Some(next), _) if !next.is_null() => Some(next.clone()),
            (_, previous) => previous.clone(),
        };
        let provider_result =
            object([("executed", data.get("executed").cloned()), ("state", data.get("native").cloned())]);
        let tool_time = json!({ "created": current.timestamp, "ran": current.timestamp, "completed": time });
        let part_time = json!({ "start": current.timestamp, "end": time });
        let tool = |state: Value| {
            object([
                ("type", Some("tool".into())),
                ("id", Some(id.into())),
                ("name", Some(current.tool.clone().into())),
                ("executed", data.get("executed").cloned()),
                ("native", native.clone()),
                ("state", Some(state)),
                ("time", Some(tool_time.clone())),
            ])
        };
        if success {
            let state = object([
                ("status", Some("completed".into())),
                ("input", Some(current.input.clone())),
                ("metadata", data.get("metadata").cloned()),
                ("content", data.get("content").cloned()),
            ]);
            let part = object([
                ("partID", Some(current.id.clone().into())),
                ("sessionID", Some(self.input.session_id.clone().into())),
                ("messageID", Some(message.into())),
                ("type", Some("tool".into())),
                ("id", Some(id.into())),
                ("tool", Some(current.tool.clone().into())),
                (
                    "state",
                    Some(object([
                        ("status", Some("completed".into())),
                        ("input", Some(current.input.clone())),
                        ("output", Some(output_text(&current.tool, data.get("content")).into())),
                        ("title", Some(current.tool.clone().into())),
                        (
                            "metadata",
                            Some(object([
                                ("metadata", data.get("metadata").cloned()),
                                ("content", data.get("content").cloned()),
                                ("providerCall", current.provider.clone()),
                                ("providerResult", Some(provider_result)),
                                ("rawInput", current.raw.clone().map(Value::from)),
                            ])),
                        ),
                        ("time", Some(part_time)),
                    ])),
                ),
            ]);
            if !self.emit("tool_use", time, [("part", part)]) {
                self.render_tool(&tool(state));
            }
            return;
        }
        let error = &data["error"];
        let metadata = data.get("metadata").cloned().unwrap_or(current.metadata.clone());
        // `nonEmptyToolContent(current.content)`: the live state never holds content.
        let content = data.get("content").cloned();
        let part = object([
            ("partID", Some(current.id.clone().into())),
            ("sessionID", Some(self.input.session_id.clone().into())),
            ("messageID", Some(message.into())),
            ("type", Some("tool".into())),
            ("id", Some(id.into())),
            ("tool", Some(current.tool.clone().into())),
            (
                "state",
                Some(object([
                    ("status", Some("error".into())),
                    ("input", Some(current.input.clone())),
                    ("error", error.get("message").cloned()),
                    (
                        "metadata",
                        Some(object([
                            ("providerCall", current.provider.clone()),
                            ("providerResult", Some(provider_result)),
                            ("rawInput", current.raw.clone().map(Value::from)),
                        ])),
                    ),
                    ("time", Some(part_time)),
                ])),
            ),
        ]);
        if self.emit("tool_use", time, [("part", part)]) {
            return;
        }
        if content.is_some() && !output_text(&current.tool, content.as_ref()).trim().is_empty() {
            self.render_tool(&tool(object([
                ("status", Some("completed".into())),
                ("input", Some(current.input.clone())),
                ("metadata", Some(metadata.clone())),
                ("content", content.clone()),
            ])));
        }
        let failed = tool(object([
            ("status", Some("error".into())),
            ("input", Some(current.input.clone())),
            ("metadata", Some(metadata)),
            ("content", content),
            ("error", Some(error.clone())),
        ]));
        self.render_tool_error(&failed);
        ui::error(text(&error["message"]));
    }

    /// Emits only the step lines, text, reasoning, tools and errors the live stream missed.
    async fn reconcile(&self) -> Result<(bool, bool), String> {
        let (found, messages) = self.projected_messages().await?;
        for message in &messages {
            if message["type"] != "assistant" {
                continue;
            }
            let id = text(&message["id"]);
            let created = message["time"]["created"].clone();
            let timestamp = match &message["time"]["completed"] {
                Value::Null => created.clone(),
                completed => completed.clone(),
            };
            let step = self.steps.borrow().get(id).copied();
            if step.is_none() {
                let part = object([
                    ("id", Some(projected_part_id(id, "step-start").into())),
                    ("sessionID", Some(self.input.session_id.clone().into())),
                    ("messageID", Some(id.into())),
                    ("type", Some("step-start".into())),
                    ("snapshot", message.get("snapshot").and_then(|s| s.get("start")).cloned()),
                ]);
                self.emit("step_start", &created, [("part", part)]);
            }
            let mut text_ordinal = 0;
            let mut reasoning_ordinal = 0;
            for item in message["content"].as_array().into_iter().flatten() {
                let item_type = text(&item["type"]);
                if item_type == "text" || item_type == "reasoning" {
                    let reasoning = item_type == "reasoning";
                    let ordinal = if reasoning { &mut reasoning_ordinal } else { &mut text_ordinal };
                    let current = *ordinal;
                    *ordinal += 1;
                    if reasoning && !self.input.thinking {
                        continue;
                    }
                    let key = content_key(id, &Value::from(current));
                    let rendered_map = if reasoning { &self.rendered_reasoning } else { &self.rendered_text };
                    let rendered = rendered_map.borrow().get(&key).cloned().unwrap_or_default();
                    let full = text(&item["text"]);
                    if rendered == full || !full.starts_with(&rendered) {
                        continue;
                    }
                    let rest = &full[rendered.len()..];
                    let part = object([
                        ("id", Some(projected_part_id(id, &format!("{item_type}-{current}")).into())),
                        ("sessionID", Some(self.input.session_id.clone().into())),
                        ("messageID", Some(id.into())),
                        ("type", Some(item_type.into())),
                        ("text", Some(rest.into())),
                        ("metadata", if reasoning { item.get("native").cloned() } else { None }),
                        ("time", Some(json!({ "start": created, "end": timestamp }))),
                    ]);
                    rendered_map.borrow_mut().insert(key, full.to_owned());
                    if reasoning {
                        self.write_reasoning(part, &timestamp);
                    } else {
                        self.write_text(part, &timestamp);
                    }
                    continue;
                }

                let item_id = text(&item["id"]);
                let key = tool_key(id, item_id);
                let status = text(&item["state"]["status"]);
                if self.rendered_tools.borrow().contains(&key) || status == "streaming" || status == "running" {
                    continue;
                }
                let name = text(&item["name"]);
                let state = &item["state"];
                let start = match &item["time"]["ran"] {
                    Value::Null => item["time"]["created"].clone(),
                    ran => ran.clone(),
                };
                let end = match &item["time"]["completed"] {
                    Value::Null => timestamp.clone(),
                    completed => completed.clone(),
                };
                let metadata =
                    object([("metadata", state.get("metadata").cloned()), ("content", state.get("content").cloned())]);
                let projected = if status == "completed" {
                    object([
                        ("status", Some("completed".into())),
                        ("input", state.get("input").cloned()),
                        ("output", Some(output_text(name, state.get("content")).into())),
                        ("title", Some(name.into())),
                        ("metadata", Some(metadata)),
                        ("time", Some(json!({ "start": start, "end": end }))),
                    ])
                } else {
                    object([
                        ("status", Some("error".into())),
                        ("input", state.get("input").cloned()),
                        ("error", state["error"].get("message").cloned()),
                        ("metadata", Some(metadata)),
                        ("time", Some(json!({ "start": start, "end": end }))),
                    ])
                };
                let part = object([
                    ("partID", Some(projected_part_id(id, &format!("tool-{item_id}")).into())),
                    ("sessionID", Some(self.input.session_id.clone().into())),
                    ("messageID", Some(id.into())),
                    ("type", Some("tool".into())),
                    ("id", Some(item_id.into())),
                    ("tool", Some(name.into())),
                    ("state", Some(projected)),
                ]);
                self.rendered_tools.borrow_mut().insert(key);
                if self.emit("tool_use", &timestamp, [("part", part)]) {
                    continue;
                }
                if status == "completed" {
                    self.render_tool(item);
                    continue;
                }
                if state.get("content").is_some_and(|content| !content.is_null())
                    && !output_text(name, state.get("content")).trim().is_empty()
                {
                    let mut completed = item.clone();
                    completed["state"] = object([
                        ("status", Some("completed".into())),
                        ("input", state.get("input").cloned()),
                        ("metadata", state.get("metadata").cloned()),
                        ("content", state.get("content").cloned()),
                    ]);
                    self.render_tool(&completed);
                }
                self.render_tool_error(item);
                ui::error(text(&state["error"]["message"]));
            }

            if step != Some(true) && !message["finish"].is_null() && !message["tokens"].is_null() {
                let part = object([
                    ("id", Some(projected_part_id(id, "step-finish").into())),
                    ("sessionID", Some(self.input.session_id.clone().into())),
                    ("messageID", Some(id.into())),
                    ("type", Some("step-finish".into())),
                    ("reason", message.get("finish").cloned()),
                    ("snapshot", message.get("snapshot").and_then(|s| s.get("end")).cloned()),
                    (
                        "cost",
                        Some(match &message["cost"] {
                            Value::Null => 0.into(),
                            cost => cost.clone(),
                        }),
                    ),
                    ("tokens", message.get("tokens").cloned()),
                ]);
                self.emit("step_finish", &timestamp, [("part", part)]);
            }

            // A declined tool call ends its step with an interrupted-step error that is only a consequence
            // of our own rejection; it was already reported above.
            let report = {
                let flags = self.flags.borrow();
                !flags.emitted_error && !flags.form_cancelled
            };
            if truthy(&message["error"]) && report {
                self.fail(&message["error"], &timestamp);
            }
        }
        let responded = messages.iter().any(|message| message["type"] == "assistant");
        Ok((found, responded))
    }

    /// The messages after this run's prompt, oldest first, and whether the prompt was found.
    async fn projected_messages(&self) -> Result<(bool, Vec<Value>), String> {
        let mut messages = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let mut call = Call::new(
                "GET",
                format!("/api/session/{}/message", path(&self.input.session_id)),
                200,
                &[400, 401, 404, 500],
            );
            call.query("limit", &200).map_err(|error| error.error_message())?;
            match &cursor {
                Some(cursor) => call.query("cursor", cursor),
                None => call.query("order", "desc"),
            }
            .map_err(|error| error.error_message())?;
            let page: Value = self
                .input
                .client
                .json(call, &RequestOptions::default())
                .await
                .map_err(|error| error.error_message())?;
            for message in page["data"].as_array().into_iter().flatten() {
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

    /// Any job in the tree holds the run open: this session's, its subagents', and theirs.
    async fn pending_background(&self) -> bool {
        if !settled_flags(&self.flags.borrow()) {
            return false;
        }
        let jobs = self
            .data(
                "/api/experimental/job",
                &[("sessionID", Value::from(self.input.session_id.clone())), ("descendants", Value::from(true))],
            )
            .await
            .unwrap_or_else(|_| json!([]));
        for job in array(Some(&jobs)) {
            self.add_job_session(text(&job["sessionID"]));
            if job["kind"] == "subagent" {
                self.add_job_session(text(&job["childSessionID"]));
            }
        }
        if !array(Some(&jobs)).is_empty() {
            return true;
        }
        // A finished job wakes its session before its row is removed, so a wake that raced the list above
        // shows up as a queued inbox item or an active session in the tree.
        let active = self.data("/api/session/active", &[]).await.unwrap_or_else(|_| json!({}));
        let sessions = self.job_sessions.borrow().clone();
        for session in sessions {
            let inbox =
                self.data(&format!("/api/session/{}/inbox", path(&session)), &[]).await.unwrap_or_else(|_| json!([]));
            if !array(Some(&inbox)).is_empty() {
                return true;
            }
        }
        for session in active.as_object().into_iter().flat_map(|active| active.keys()) {
            if self.owns(session).await {
                return true;
            }
        }
        false
    }

    fn add_job_session(&self, session: &str) {
        let mut sessions = self.job_sessions.borrow_mut();
        if !sessions.iter().any(|known| known == session) {
            sessions.push(session.to_owned());
        }
    }

    /// Subagents run in child sessions; their asks and questions belong to this run too. Other sessions on
    /// a shared server (the TUI's, for example) are left alone.
    fn owns<'a>(&'a self, session: &'a str) -> std::pin::Pin<Box<dyn Future<Output = bool> + 'a>> {
        Box::pin(async move {
            if let Some(known) = self.owned.borrow().get(session) {
                return *known;
            }
            let result = if session == GLOBAL_FORM_SESSION_ID {
                false
            } else {
                match self.data(&format!("/api/session/{}", path(session)), &[]).await {
                    Ok(info) => match info["parentID"].as_str() {
                        Some(parent) if !parent.is_empty() => self.owns(parent).await,
                        _ => false,
                    },
                    Err(_) => false,
                }
            };
            self.owned.borrow_mut().insert(session.to_owned(), result);
            result
        })
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
                    "{}permission requested: {} ({resources}); auto-rejecting",
                    ui::TEXT_NORMAL,
                    text(&request["action"])
                ),
            ]);
        }
        let _ = self
            .input
            .client
            .permission_reply(
                &PermissionReplyInput {
                    session_id: SessionID(text(&request["sessionID"]).to_owned()),
                    request_id: PermissionID(text(&request["id"]).to_owned()),
                    decision: if auto { PermissionReply::Once } else { PermissionReply::Reject },
                    message: (!auto).then(|| PERMISSION_REJECTED_FEEDBACK.to_owned()),
                },
                &RequestOptions::default(),
            )
            .await;
    }

    /// Nobody can answer a form here. A question is cancelled with a message so the model continues
    /// without an answer; any other form ends the run with exit code 1.
    async fn cancel_form(&self, form: &Value) -> Result<(), String> {
        let continuing = form["metadata"]["kind"] == "question";
        let result = self
            .input
            .client
            .session_form_cancel(
                &SessionFormCancelInput {
                    session_id: text(&form["sessionID"]).to_owned(),
                    form_id: FormID(text(&form["id"]).to_owned()),
                    message: continuing.then(|| QUESTION_CANCELLED_FEEDBACK.to_owned()),
                },
                &RequestOptions::default(),
            )
            .await;
        if let Err(error) = result {
            let settled =
                error.declared().is_some_and(|declared| declared.tag.as_deref() == Some("FormAlreadySettledError"));
            if !settled {
                return Err(error.error_message());
            }
        }
        if continuing {
            return Ok(());
        }
        self.flags.borrow_mut().form_cancelled = true;
        self.input.exit.set(1);
        Ok(())
    }

    /// `GET path` and its `data`, as the TS Promise client unwraps it.
    async fn data(&self, path: &str, query: &[(&str, Value)]) -> Result<Value, ApiError> {
        let mut call = Call::new("GET", path.to_owned(), 200, &[400, 401, 404]);
        for (key, value) in query {
            call.query(key, value)?;
        }
        let mut value: Value = self.input.client.json(call, &RequestOptions::default()).await?;
        Ok(value.get_mut("data").map(Value::take).unwrap_or(Value::Null))
    }

    /// A step or execution error: exit code 1, then the error line or JSON event.
    fn fail(&self, error: &Value, time: &Value) {
        self.flags.borrow_mut().emitted_error = true;
        self.input.exit.set(1);
        if !self.emit("error", time, [("error", error.clone())]) {
            ui::error(text(&error["message"]));
        }
    }

    fn emit<const N: usize>(&self, kind: &str, timestamp: &Value, data: [(&str, Value); N]) -> bool {
        if !self.input.json {
            return false;
        }
        let mut line = Map::new();
        line.insert("type".into(), kind.into());
        line.insert("timestamp".into(), timestamp.clone());
        line.insert("sessionID".into(), self.input.session_id.clone().into());
        for (key, value) in data {
            line.insert(key.into(), value);
        }
        let _ = crate::output::print(&(Value::Object(line).to_string() + "\n"));
        true
    }

    fn write_text(&self, part: Value, time: &Value) {
        if self.emit("text", time, [("part", part.clone())]) {
            return;
        }
        let body = text(&part["text"]).trim();
        if body.is_empty() {
            return;
        }
        if !std::io::stdout().is_terminal() {
            let _ = crate::output::print(&format!("{body}\n"));
            return;
        }
        ui::empty();
        ui::println(&[body]);
        ui::empty();
    }

    fn write_reasoning(&self, part: Value, time: &Value) {
        if self.emit("reasoning", time, [("part", part.clone())]) {
            return;
        }
        let body = text(&part["text"]).trim();
        if body.is_empty() {
            return;
        }
        let line = format!("Thinking: {body}");
        if !std::io::stdout().is_terminal() {
            let _ = crate::output::print(&format!("{line}\n"));
            return;
        }
        ui::empty();
        ui::println(&[&format!("{}\x1b[3m{line}\x1b[0m{}", ui::TEXT_DIM, ui::TEXT_NORMAL)]);
        ui::empty();
    }

    fn render_tool(&self, part: &Value) {
        let Some(info) = inline(part, &self.input.directory) else {
            return;
        };
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

    fn render_tool_error(&self, part: &Value) {
        let Some(info) = inline(part, &self.input.directory) else {
            return;
        };
        ui::println(&[&format!("{}✗", ui::TEXT_NORMAL), &format!("{}{} failed", ui::TEXT_NORMAL, info.title)]);
    }
}

/// On SIGINT or SIGTERM, interrupt the session before `signals` exits with 130, as the TS handler sends
/// `session.interrupt` while Effect tears the run down.
fn interrupt_on_shutdown(client: Client, session: String) -> crate::signals::Registration {
    crate::signals::on_shutdown("interrupt the session", move || {
        let Ok(runtime) = tokio::runtime::Builder::new_current_thread().enable_all().build() else {
            return;
        };
        let call = Call::new("POST", format!("/api/session/{}/interrupt", path(&session)), 200, &[400, 401, 404]);
        let options = RequestOptions::default();
        let request = client.json::<Value>(call, &options);
        let _ = runtime.block_on(async { tokio::time::timeout(std::time::Duration::from_secs(5), request).await });
    })
}

fn settled_flags(flags: &Flags) -> bool {
    !flags.form_cancelled && !flags.emitted_error
}

/// `toolInlineInfo` over the JSON part. The generated type needs `metadata` and `content`, which the TS
/// summary reads as optional.
fn inline(part: &Value, directory: &str) -> Option<opencode_ui::tool_info::ToolInline> {
    let mut part = part.clone();
    if let Some(state) = part["state"].as_object_mut() {
        state.entry("metadata").or_insert_with(|| json!({}));
        if state.get("content").is_none_or(Value::is_null) {
            state.insert("content".into(), json!([]));
        }
    }
    match serde_json::from_value::<SessionMessageAssistantTool>(part) {
        Ok(tool) => Some(tool_inline_info(&tool, Some(directory))),
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

/// An object of the fields that are present: `undefined` fields vanish from `JSON.stringify`.
fn object<const N: usize>(fields: [(&str, Option<Value>); N]) -> Value {
    Value::Object(fields.into_iter().filter_map(|(key, value)| value.map(|value| (key.to_owned(), value))).collect())
}

fn array(value: Option<&Value>) -> &[Value] {
    value.and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

fn text(value: &Value) -> &str {
    value.as_str().unwrap_or_default()
}

fn truthy(value: &Value) -> bool {
    !matches!(value, Value::Null | Value::Bool(false))
}

fn path(segment: &str) -> String {
    opencode_api::client::path_param(segment).unwrap_or_else(|_| segment.to_owned())
}

fn event_time(event: &Value) -> Value {
    match &event["created"] {
        Value::Number(number) => Value::Number(number.clone()),
        _ => now(),
    }
}

fn now() -> Value {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64);
    Value::from(millis)
}

fn part_id(event_id: &str) -> String {
    format!("prt_{}", event_id.strip_prefix("evt_").unwrap_or(event_id))
}

fn projected_part_id(message_id: &str, part: &str) -> String {
    format!("prt_{}_{part}", message_id.strip_prefix("msg_").unwrap_or(message_id))
}

fn tool_key(message_id: &str, id: &str) -> String {
    format!("{message_id}\0{id}")
}

fn content_key(message_id: &str, ordinal: &Value) -> String {
    format!("{message_id}\0{ordinal}")
}
