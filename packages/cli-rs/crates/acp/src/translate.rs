//! Translates server events into ACP updates and the final prompt response.

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use indexmap::{Equivalent, IndexMap};
use opencode_api::de::Raw;
use opencode_api::generated::{
    FormInfo, PermissionAskedData, SessionCreatedData, SessionID, SessionInboxCancelled, SessionInboxDelivered,
    SessionInboxEnqueuedData, SessionInboxItem, SessionMessageAssistantFinish, SessionStructuredError, TokenUsageInfo,
    V2Event,
};
use opencode_util::json_object;
use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Value, json};

use crate::child;
use crate::compaction;
use crate::error::Failure;
use crate::tools::{self, DiffSource, Part};
use crate::update::{Chunk, Content, Id, Input, Kind, Meta, Update};

const RETRY_META: &str = "opencode/retry";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartKind {
    Input,
    Compaction,
}

/// The inbox item that starts the turn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurnStart {
    pub kind: StartKind,
    pub id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Terminal {
    Succeeded,
    Failed,
    Interrupted,
}

#[derive(Debug, Clone)]
pub struct TurnContext {
    pub session_id: String,
    pub cwd: String,
    /// None while following children after the prompt responded: any delivery then starts a parent turn.
    pub start: Option<TurnStart>,
    pub child_updates: bool,
    pub compaction: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Tool {
    pub name: String,
    pub input: Arc<Input>,
    pub metadata: Input,
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Tokens {
    pub input: f64,
    pub output: f64,
    pub reasoning: f64,
    pub cache_read: f64,
    pub cache_write: f64,
}

impl Tokens {
    fn of(tokens: &TokenUsageInfo) -> Self {
        Self {
            input: tokens.input,
            output: tokens.output,
            reasoning: tokens.reasoning,
            cache_read: tokens.cache.read,
            cache_write: tokens.cache.write,
        }
    }

    /// `TokenUsage.total`.
    pub fn total(&self) -> f64 {
        self.input + self.output + self.reasoning + self.cache_read + self.cache_write
    }

    fn add(&self, other: &Self) -> Self {
        Self {
            input: self.input + other.input,
            output: self.output + other.output,
            reasoning: self.reasoning + other.reasoning,
            cache_read: self.cache_read + other.cache_read,
            cache_write: self.cache_write + other.cache_write,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Usage {
    /// Summed over the turn's steps.
    pub turn: Tokens,
    /// The last step's, which is what the context holds.
    pub last: Tokens,
}

#[derive(Debug, Clone, Default)]
pub struct TurnState {
    pub started: bool,
    /// By session and tool call ID, in the order the tools started.
    pub tools: IndexMap<(SessionID, String), Tool>,
    pub retries: HashMap<String, Retry>,
    pub compactions: compaction::Tracked,
    pub children: HashMap<String, Arc<child::Session>>,
    pub open_children: HashSet<String>,
    /// Background shells that will wake their session, with the inbox ID of their notice once it is queued.
    pub shells: HashMap<String, Option<String>>,
    pub asks: HashSet<String>,
    pub finish: Option<SessionMessageAssistantFinish>,
    pub usage: Option<Usage>,
    pub step_error: Option<SessionStructuredError>,
    pub execution_error: Option<SessionStructuredError>,
}

/// A scheduled retry, as `_meta["opencode/retry"]` shows it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Retry {
    pub attempt: i64,
    pub next_retry_at: Option<String>,
    pub error: Value,
}

/// An event, with the error it carries as it arrived when ACP forwards that error whole (a retry's, a failed child's,
/// a failed compaction's), so the fields this client does not know pass through.
#[derive(Debug)]
pub struct Event {
    pub event: V2Event,
    pub error: Option<Value>,
}

impl<'de> Deserialize<'de> for Event {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct Carries {
            data: Error,
        }
        #[derive(Deserialize)]
        struct Error {
            error: Value,
        }
        let raw = Raw::deserialize(deserializer)?;
        let event = V2Event::from_raw(&raw).map_err(D::Error::custom)?;
        let forwards = matches!(
            event,
            V2Event::SessionRetryScheduled(_)
                | V2Event::SessionExecutionFailed(_)
                | V2Event::SessionCompactionFailed(_)
        );
        let error = forwards.then(|| raw.decode::<Carries>()).transpose().map_err(D::Error::custom)?;
        Ok(Self { event, error: error.map(|carries| carries.data.error) })
    }
}

/// A tool's key borrowed from an event, to find the tool without building its key.
#[derive(Hash)]
struct ToolRef<'a>(&'a str, &'a str);

impl Equivalent<(SessionID, String)> for ToolRef<'_> {
    fn equivalent(&self, key: &(SessionID, String)) -> bool {
        self.0 == key.0.as_str() && self.1 == key.1
    }
}

#[derive(Debug, Clone)]
pub enum Output<'a> {
    SessionUpdate { update: Update<'a>, diff: Option<DiffSource> },
    ChildUpdate { update: child::Update<'a>, diff: Option<DiffSource> },
    PermissionAsk { ask: PermissionAskedData, tool: Option<Tool>, child: Option<Arc<child::Session>> },
    FormAsk { form: FormInfo, child: Option<Arc<child::Session>> },
    AskSettled { id: &'a str },
}

#[derive(Debug, Clone, Default)]
pub struct Folded<'a> {
    pub outputs: Vec<Output<'a>>,
    pub terminal: Option<Terminal>,
}

impl<'a> Folded<'a> {
    fn new(outputs: Vec<Output<'a>>) -> Self {
        Self { outputs, terminal: None }
    }
}

pub fn fold<'a>(state: &mut TurnState, incoming: &'a Event, ctx: &'a TurnContext) -> Folded<'a> {
    let event = &incoming.event;
    let session_id = session_of(event);
    let child = session_id.and_then(|id| state.children.get(id)).cloned();
    let open_child = child.clone().filter(|child| state.open_children.contains(&child.id));
    match event {
        V2Event::SessionCreated(created) => return child_created(state, &created.data, ctx),
        V2Event::PermissionAsked(asked) if asked.data.session_id.as_str() == ctx.session_id || open_child.is_some() => {
            let data = &asked.data;
            let tool = data
                .source
                .as_ref()
                .filter(|source| !source.id.is_empty())
                .and_then(|source| state.tools.get(&ToolRef(data.session_id.as_str(), &source.id)))
                .cloned();
            state.asks.insert(data.id.0.clone());
            return Folded::new(vec![Output::PermissionAsk { ask: data.clone(), tool, child: open_child }]);
        }
        V2Event::FormCreated(created) if created.data.form.session_id == ctx.session_id || open_child.is_some() => {
            state.asks.insert(created.data.form.id.0.clone());
            return Folded::new(vec![Output::FormAsk { form: created.data.form.clone(), child: open_child }]);
        }
        _ => {}
    }
    let settled = match event {
        V2Event::PermissionReplied(replied) => Some(replied.data.request_id.as_str()),
        V2Event::FormReplied(replied) => Some(replied.data.id.as_str()),
        V2Event::FormCancelled(cancelled) => Some(cancelled.data.id.as_str()),
        _ => None,
    };
    if let Some(id) = settled.filter(|id| !id.is_empty() && state.asks.remove(*id)) {
        return Folded::new(vec![Output::AskSettled { id }]);
    }
    let Some(session_id) = session_id else { return Folded::default() };
    if session_id != ctx.session_id && child.is_none() {
        return Folded::default();
    }
    match event {
        V2Event::SessionInboxEnqueued(enqueued) => {
            shell_noticed(state, &enqueued.data);
            return Folded::default();
        }
        V2Event::SessionInboxDelivered(SessionInboxDelivered { data, .. })
        | V2Event::SessionInboxCancelled(SessionInboxCancelled { data, .. }) => {
            let inbox = data.inbox_id.as_str();
            state.shells.retain(|_, notice| notice.as_deref() != Some(inbox));
            if session_id == ctx.session_id
                && matches!(event, V2Event::SessionInboxDelivered(_))
                && ctx.start.as_ref().is_none_or(|start| inbox == start.id)
            {
                state.started = true;
            }
            return Folded::default();
        }
        _ => {}
    }
    if child.is_none() && !state.started {
        return Folded::default();
    }
    match child {
        Some(child) => child_event(state, incoming, ctx, &child),
        None => root_event(state, incoming, ctx),
    }
}

/// Whether work that outlives the turn, such as a background child or shell, can still wake the session.
pub fn pending(state: &TurnState) -> bool {
    !state.open_children.is_empty() || !state.shells.is_empty()
}

/// A background shell's notice wakes the session once delivered, so the shell stays pending until then. Only a
/// job's notice wakes it: a user's shell command queues one without a job ID that waits for the next prompt.
fn shell_noticed(state: &mut TurnState, data: &SessionInboxEnqueuedData) {
    let SessionInboxItem::Synthetic(item) = &data.item else { return };
    let text = |key| item.payload.metadata.as_ref()?.get(key)?.as_str();
    let (Some(shell), Some(_)) = (text("shellID"), text("jobID")) else { return };
    state.shells.insert(shell.to_owned(), Some(data.inbox_id.0.clone()));
}

/// `projectChild`: without the child capability, only the prompt turn that started a child shows its work.
pub fn project_child(ctx: &TurnContext, child: &child::Session) -> bool {
    !ctx.child_updates && ctx.start.as_ref().is_some_and(|start| child.turn_id.as_ref() == Some(&start.id))
}

pub fn failure(state: &TurnState) -> Option<Failure> {
    let error = state.step_error.as_ref().or(state.execution_error.as_ref())?;
    if error.r#type == "provider.auth" {
        return Some(Failure::AuthRequired);
    }
    if error.r#type == "aborted" || error.r#type == "provider.content-filter" {
        return None;
    }
    Some(Failure::ServiceFailure {
        safe_message: Some(error.message.as_str())
            .filter(|message| !message.is_empty())
            .unwrap_or("OpenCode prompt failed")
            .to_owned(),
        service: Some("session".to_owned()),
        error_name: Some(error.r#type.clone()),
        status: error.status,
        retry_after_ms: error.retry_after_ms,
    })
}

/// A JSON number as JavaScript writes it: integral values without a fraction.
pub fn number(value: f64) -> Value {
    if value.fract() == 0.0 && value.abs() < 9_007_199_254_740_992.0 {
        #[allow(clippy::cast_possible_truncation)]
        return json!(value as i64);
    }
    json!(value)
}

pub fn response(state: &TurnState, session_id: &str, terminal: Terminal) -> Value {
    let error = state.step_error.as_ref().or(state.execution_error.as_ref()).map(|error| error.r#type.as_str());
    let usage = state.usage.as_ref().map(|usage| {
        let tokens = usage.turn;
        let positive = |value: f64| (value > 0.0).then(|| number(value));
        json_object! {
            "inputTokens": number(tokens.input),
            "outputTokens": number(tokens.output),
            "totalTokens": number(tokens.total()),
            "thoughtTokens"?: positive(tokens.reasoning),
            "cachedReadTokens"?: positive(tokens.cache_read),
            "cachedWriteTokens"?: positive(tokens.cache_write),
        }
    });
    // Interruption clears the projected retry, so a retry pending at interrupt is reported here.
    let meta = match state.retries.get(session_id) {
        Some(retry) => json!({ (RETRY_META): retry }),
        None => json!({}),
    };
    let finish = state.finish.as_ref().map(SessionMessageAssistantFinish::as_str);
    json_object! { "stopReason": stop_reason(terminal, finish, error), "usage"?: usage, "_meta": meta }
}

// Child compactions are left to the background consumer.
pub fn abandon<'a>(state: &mut TurnState, ctx: &'a TurnContext) -> Folded<'a> {
    let mut outputs: Vec<Output> = std::mem::take(&mut state.tools)
        .into_iter()
        .flat_map(|((session_id, id), tool)| {
            let metadata = Some(Cow::Owned(tool.metadata));
            let id = Cow::Owned(id);
            let update = tools::error_tool_update(id, &tool.name, &tool.input, &[], metadata, "Cancelled", &ctx.cwd);
            route(ctx, state.children.get(session_id.as_str()), Kind::ToolCallUpdate(update).into())
        })
        .collect();
    if let Some(started) = state.compactions.remove(&ctx.session_id)
        && let Some(update) =
            compaction::abandon(&started, compaction::uses_standard_updates(ctx.compaction, ctx.child_updates, false))
    {
        outputs.extend(route(ctx, None, update));
    }
    Folded::new(outputs)
}

fn child_created<'a>(state: &mut TurnState, data: &SessionCreatedData, ctx: &'a TurnContext) -> Folded<'a> {
    let Some(parent_id) = data.parent_id.as_ref().map(SessionID::as_str).filter(|id| !id.is_empty()) else {
        return Folded::default();
    };
    let parent = (parent_id != ctx.session_id).then(|| state.children.get(parent_id)).flatten();
    if parent.is_none() && parent_id != ctx.session_id {
        return Folded::default();
    }
    let child = Arc::new(child::Session {
        id: data.session_id.0.clone(),
        parent_id: parent_id.to_owned(),
        depth: parent.map_or(1, |parent| parent.depth + 1),
        title: data.title.clone(),
        turn_id: match parent {
            Some(parent) => parent.turn_id.clone(),
            None => ctx.start.as_ref().map(|start| start.id.clone()),
        },
    });
    let outputs = child_status(ctx, &child, child::Event::Status("created", None));
    state.open_children.insert(child.id.clone());
    state.children.insert(child.id.clone(), child);
    Folded::new(outputs)
}

fn root_event<'a>(state: &mut TurnState, incoming: &'a Event, ctx: &'a TurnContext) -> Folded<'a> {
    match &incoming.event {
        V2Event::SessionStepStarted(_) => {
            state.step_error = None;
            session_event(state, incoming, ctx, None)
        }
        V2Event::SessionStepEnded(ended) => {
            record_step(state, &ended.data.tokens);
            state.finish = Some(ended.data.finish.clone());
            Folded::default()
        }
        V2Event::SessionStepFailed(failed) => {
            if let Some(tokens) = &failed.data.tokens {
                record_step(state, tokens);
            }
            state.step_error = Some(failed.data.error.clone());
            Folded::default()
        }
        // Following children, the next delivery starts the next parent turn.
        V2Event::SessionExecutionSucceeded(_) => terminal(state, ctx, Terminal::Succeeded),
        V2Event::SessionExecutionInterrupted(_) => terminal(state, ctx, Terminal::Interrupted),
        V2Event::SessionExecutionFailed(failed) => {
            state.execution_error = Some(failed.data.error.clone());
            terminal(state, ctx, Terminal::Failed)
        }
        _ => session_event(state, incoming, ctx, None),
    }
}

fn terminal<'a>(state: &mut TurnState, ctx: &TurnContext, terminal: Terminal) -> Folded<'a> {
    state.started = ctx.start.is_some();
    Folded { outputs: Vec::new(), terminal: Some(terminal) }
}

fn child_event<'a>(
    state: &mut TurnState,
    incoming: &'a Event,
    ctx: &'a TurnContext,
    child: &Arc<child::Session>,
) -> Folded<'a> {
    match &incoming.event {
        V2Event::SessionExecutionStarted(_) => {
            state.open_children.insert(child.id.clone());
            Folded::new(child_status(ctx, child, child::Event::Status("running", None)))
        }
        V2Event::SessionExecutionSucceeded(_) => {
            child_ended(state, ctx, child, child::Event::Status("completed", None))
        }
        V2Event::SessionExecutionInterrupted(_) => {
            child_ended(state, ctx, child, child::Event::Status("interrupted", None))
        }
        V2Event::SessionExecutionFailed(_) => {
            child_ended(state, ctx, child, child::Event::Status("failed", Some(forwarded(incoming))))
        }
        _ => session_event(state, incoming, ctx, Some(child)),
    }
}

fn session_event<'a>(
    state: &mut TurnState,
    incoming: &'a Event,
    ctx: &'a TurnContext,
    child: Option<&Arc<child::Session>>,
) -> Folded<'a> {
    let session_id = child.map_or(ctx.session_id.as_str(), |child| child.id.as_str());
    let send = |updates: Vec<Update<'a>>| Folded::new(updates.into_iter().flat_map(|u| route(ctx, child, u)).collect());
    let standard = compaction::uses_standard_updates(ctx.compaction, ctx.child_updates, child.is_some());
    let info =
        |retry| Update { kind: Kind::SessionInfoUpdate {}, meta: Meta { retry: Some(retry), ..Meta::default() } };
    let chunk =
        |message_id, delta: &'a str| Chunk { message_id, content: Content::Text { text: Cow::Borrowed(delta) } };
    let cwd = ctx.cwd.as_str();
    let update = match &incoming.event {
        V2Event::SessionStepStarted(_) => {
            if state.retries.remove(session_id).is_none() {
                return Folded::default();
            }
            info(None)
        }
        V2Event::SessionRetryScheduled(scheduled) => {
            let data = &scheduled.data;
            let retry = Retry {
                attempt: data.attempt,
                next_retry_at: opencode_util::time::iso(data.at),
                error: forwarded(incoming).clone(),
            };
            state.retries.insert(session_id.to_owned(), retry.clone());
            info(Some(retry))
        }
        V2Event::SessionCompactionStarted(started) => compaction::started(&mut state.compactions, started, standard),
        V2Event::SessionCompactionEnded(ended) => {
            return send(compaction::ended(&mut state.compactions, ended, standard).into_iter().collect());
        }
        V2Event::SessionCompactionFailed(failed) => {
            return send(compaction::failed(&mut state.compactions, failed, forwarded(incoming), standard));
        }
        V2Event::SessionCompactionDelta(delta) => {
            let update = compaction::chunk(state.compactions.get(session_id), &delta.data.text, standard);
            return send(update.into_iter().collect());
        }
        V2Event::SessionTextDelta(delta) => {
            let data = &delta.data;
            Kind::AgentMessageChunk(chunk(Id::Message(data.assistant_message_id.as_str()), &data.delta)).into()
        }
        V2Event::SessionReasoningDelta(delta) => {
            let data = &delta.data;
            Kind::AgentThoughtChunk(chunk(Id::Reasoning(data.assistant_message_id.as_str(), data.ordinal), &data.delta))
                .into()
        }
        V2Event::SessionToolInputStarted(started) => {
            let data = &started.data;
            let tool = new_tool(&data.name);
            let update = tools::pending_tool_call(Cow::Borrowed(&data.id), &data.name, &tool.input, None, cwd);
            state.tools.insert((data.session_id.clone(), data.id.clone()), tool);
            Kind::ToolCall(update).into()
        }
        V2Event::SessionToolCalled(called) => {
            let data = &called.data;
            let tool = tool_mut(&mut state.tools, &data.session_id, &data.id);
            tool.input = Arc::new(data.input.clone());
            Kind::ToolCallUpdate(tools::running_tool_update(Cow::Borrowed(&data.id), &tool.name, &tool.input, cwd))
                .into()
        }
        V2Event::SessionToolProgress(progress) => {
            let data = &progress.data;
            let Some(tool) = state.tools.get_mut(&ToolRef(data.session_id.as_str(), &data.id)) else {
                return Folded::default();
            };
            tool.metadata = data.metadata.clone();
            Kind::ToolCallUpdate(tools::running_tool_update(Cow::Borrowed(&data.id), &tool.name, &tool.input, cwd))
                .into()
        }
        V2Event::SessionToolSuccess(success) => {
            let data = &success.data;
            let tool = state
                .tools
                .shift_remove(&ToolRef(data.session_id.as_str(), &data.id))
                .unwrap_or_else(|| new_tool("tool"));
            let metadata = data.metadata.as_ref();
            let text = |key| metadata?.get(key)?.as_str();
            // A shell moved to the background reports its end through a notice that wakes the session. A command
            // that exits at once can queue its notice first; keep the notice it already has.
            if text("status") == Some("running")
                && let Some(shell) = text("shellID")
            {
                state.shells.entry(shell.to_owned()).or_insert(None);
            }
            let parts: Vec<Part> = data.content.iter().map(Part::of).collect();
            let id = Cow::Borrowed(data.id.as_str());
            let update =
                tools::completed_tool_update(id, &tool.name, &tool.input, &parts, metadata.map(Cow::Borrowed), cwd);
            let source = DiffSource { tool_name: tool.name, input: tool.input, metadata: metadata.cloned() };
            let outputs = route(ctx, child, Kind::ToolCallUpdate(update).into());
            return Folded::new(outputs.into_iter().map(|output| with_diff(output, &source)).collect());
        }
        V2Event::SessionToolFailed(failed) => {
            let data = &failed.data;
            let tool = state
                .tools
                .shift_remove(&ToolRef(data.session_id.as_str(), &data.id))
                .unwrap_or_else(|| new_tool("tool"));
            let metadata = data.metadata.as_ref().map_or(Cow::Owned(tool.metadata), Cow::Borrowed);
            let parts: Vec<Part> = data.content.iter().flatten().map(Part::of).collect();
            let (id, message) = (Cow::Borrowed(data.id.as_str()), data.error.message.as_str());
            let update = tools::error_tool_update(id, &tool.name, &tool.input, &parts, Some(metadata), message, cwd);
            Kind::ToolCallUpdate(update).into()
        }
        _ => return Folded::default(),
    };
    Folded::new(route(ctx, child, update))
}

/// The error an event carries as it arrived.
fn forwarded(event: &Event) -> &Value {
    event.error.as_ref().unwrap_or(&Value::Null)
}

/// The session an event is about, for the events the fold reads.
fn session_of(event: &V2Event) -> Option<&str> {
    macro_rules! session {
        ($($variant:ident),*) => {
            match event {
                $(V2Event::$variant(event) => Some(event.data.session_id.as_str()),)*
                V2Event::FormCreated(event) => Some(event.data.form.session_id.as_str()),
                _ => None,
            }
        };
    }
    session!(
        PermissionAsked,
        SessionInboxEnqueued,
        SessionInboxDelivered,
        SessionInboxCancelled,
        SessionStepStarted,
        SessionStepEnded,
        SessionStepFailed,
        SessionExecutionStarted,
        SessionExecutionSucceeded,
        SessionExecutionFailed,
        SessionExecutionInterrupted,
        SessionRetryScheduled,
        SessionCompactionStarted,
        SessionCompactionDelta,
        SessionCompactionEnded,
        SessionCompactionFailed,
        SessionTextDelta,
        SessionReasoningDelta,
        SessionToolInputStarted,
        SessionToolCalled,
        SessionToolProgress,
        SessionToolSuccess,
        SessionToolFailed
    )
}

fn with_diff<'a>(output: Output<'a>, source: &DiffSource) -> Output<'a> {
    match output {
        Output::SessionUpdate { update, .. } => Output::SessionUpdate { update, diff: Some(source.clone()) },
        Output::ChildUpdate { update, .. } => Output::ChildUpdate { update, diff: Some(source.clone()) },
        other => other,
    }
}

fn new_tool(name: &str) -> Tool {
    Tool { name: name.to_owned(), input: Arc::default(), metadata: Input::new() }
}

/// The tool, started now if its input did not stream.
fn tool_mut<'s>(tools: &'s mut IndexMap<(SessionID, String), Tool>, session_id: &SessionID, id: &str) -> &'s mut Tool {
    let index = tools
        .get_index_of(&ToolRef(session_id.as_str(), id))
        .unwrap_or_else(|| tools.insert_full((session_id.clone(), id.to_owned()), new_tool("tool")).0);
    &mut tools[index]
}

fn route<'a>(ctx: &'a TurnContext, child: Option<&Arc<child::Session>>, mut update: Update<'a>) -> Vec<Output<'a>> {
    let Some(child) = child else { return vec![Output::SessionUpdate { update, diff: None }] };
    child::project(&mut update, child);
    if ctx.child_updates {
        return child_status(ctx, child, child::Event::Update(update));
    }
    if !project_child(ctx, child) {
        return Vec::new();
    }
    vec![Output::SessionUpdate { update, diff: None }]
}

fn child_status<'a>(ctx: &'a TurnContext, child: &Arc<child::Session>, event: child::Event<'a>) -> Vec<Output<'a>> {
    if !ctx.child_updates {
        return Vec::new();
    }
    let update = child::Update { root_session_id: &ctx.session_id, child: child.clone(), event };
    vec![Output::ChildUpdate { update, diff: None }]
}

fn child_ended<'a>(
    state: &mut TurnState,
    ctx: &'a TurnContext,
    child: &Arc<child::Session>,
    status: child::Event<'a>,
) -> Folded<'a> {
    state.open_children.remove(&child.id);
    Folded::new(child_status(ctx, child, status))
}

fn record_step(state: &mut TurnState, tokens: &TokenUsageInfo) {
    let tokens = Tokens::of(tokens);
    state.usage = Some(Usage { turn: state.usage.map_or(tokens, |usage| usage.turn.add(&tokens)), last: tokens });
}

fn stop_reason(terminal: Terminal, finish: Option<&str>, error: Option<&str>) -> &'static str {
    if terminal == Terminal::Interrupted || error == Some("aborted") {
        return "cancelled";
    }
    if finish == Some("length") {
        return "max_tokens";
    }
    if finish == Some("content-filter") || error == Some("provider.content-filter") {
        return "refusal";
    }
    "end_turn"
}
