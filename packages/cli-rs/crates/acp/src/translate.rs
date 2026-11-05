//! Server events of one turn as ACP updates, asks, and the prompt response
//! (`packages/cli/src/acp/translate.ts`). Events stay JSON, as the server sends them.

use std::collections::{HashMap, HashSet};

use indexmap::IndexMap;
use serde_json::{Map, Value, json};

use crate::child;
use crate::compaction;
use crate::error::Failure;
use crate::tools::{DiffSource, completed_tool_update, error_tool_update, pending_tool_call, running_tool_update};

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
    pub start: TurnStart,
    pub child_updates: bool,
    pub compaction: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Tool {
    pub session_id: String,
    pub id: String,
    pub name: String,
    pub input: Value,
    pub metadata: Value,
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
    fn from_json(value: &Value) -> Self {
        let number = |value: Option<&Value>| value.and_then(Value::as_f64).unwrap_or_default();
        let cache = value.get("cache");
        Self {
            input: number(value.get("input")),
            output: number(value.get("output")),
            reasoning: number(value.get("reasoning")),
            cache_read: number(cache.and_then(|cache| cache.get("read"))),
            cache_write: number(cache.and_then(|cache| cache.get("write"))),
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
    /// By `sessionID:toolID`, in the order the tools started.
    pub tools: IndexMap<String, Tool>,
    pub retries: HashMap<String, Value>,
    pub compactions: compaction::Tracked,
    pub children: HashMap<String, child::Session>,
    pub open_children: HashSet<String>,
    pub asks: HashSet<String>,
    pub finish: Option<String>,
    pub usage: Option<Usage>,
    pub step_error: Option<Value>,
    pub execution_error: Option<Value>,
}

#[derive(Debug, Clone)]
pub enum Output {
    SessionUpdate { update: Value, diff: Option<DiffSource> },
    ChildUpdate { update: Value, diff: Option<DiffSource> },
    PermissionAsk { event: Value, tool: Option<Tool>, child: Option<child::Session> },
    FormAsk { form: Value, child: Option<child::Session> },
    AskSettled { id: String },
}

#[derive(Debug, Clone, Default)]
pub struct Folded {
    pub outputs: Vec<Output>,
    pub terminal: Option<Terminal>,
}

impl Folded {
    fn new(outputs: Vec<Output>) -> Self {
        Self { outputs, terminal: None }
    }
}

fn data(event: &Value) -> &Value {
    event.get("data").unwrap_or(&Value::Null)
}

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn kind(event: &Value) -> &str {
    text(event, "type").unwrap_or_default()
}

pub fn fold(state: &mut TurnState, event: &Value, ctx: &TurnContext) -> Folded {
    if kind(event) == "session.created" {
        return child_created(state, event, ctx);
    }
    let data = data(event);
    let session_id = session_id_from_event(event);
    let child = session_id.and_then(|id| state.children.get(id)).cloned();

    match kind(event) {
        "permission.asked" if text(data, "sessionID") == Some(ctx.session_id.as_str()) || child.is_some() => {
            let tool = data
                .get("source")
                .and_then(|source| text(source, "id"))
                .filter(|id| !id.is_empty())
                .and_then(|id| state.tools.get(&tool_key(text(data, "sessionID").unwrap_or_default(), id)))
                .cloned();
            state.asks.insert(text(data, "id").unwrap_or_default().to_owned());
            return Folded::new(vec![Output::PermissionAsk { event: event.clone(), tool, child }]);
        }
        "form.created" => {
            let form = data.get("form").cloned().unwrap_or(Value::Null);
            if text(&form, "sessionID") == Some(ctx.session_id.as_str()) || child.is_some() {
                state.asks.insert(text(&form, "id").unwrap_or_default().to_owned());
                return Folded::new(vec![Output::FormAsk { form, child }]);
            }
        }
        _ => {}
    }
    let settled = match kind(event) {
        "permission.replied" => text(data, "requestID"),
        "form.replied" | "form.cancelled" => text(data, "id"),
        _ => None,
    };
    if let Some(id) = settled.filter(|id| !id.is_empty() && state.asks.remove(*id)) {
        return Folded::new(vec![Output::AskSettled { id: id.to_owned() }]);
    }
    let Some(session_id) = session_id else {
        return Folded::default();
    };
    if session_id != ctx.session_id && child.is_none() {
        return Folded::default();
    }
    if kind(event) == "session.inbox.delivered" && text(data, "inboxID") == Some(&ctx.start.id) {
        state.started = true;
        return Folded::default();
    }
    if !state.started {
        return Folded::default();
    }
    match child {
        Some(child) => child_event(state, event, ctx, &child),
        None => root_event(state, event, ctx),
    }
}

pub fn from_tracked_child(state: &TurnState, event: &Value) -> bool {
    let session_id =
        if kind(event) == "session.created" { text(data(event), "parentID") } else { session_id_from_event(event) };
    session_id.is_some_and(|id| state.children.contains_key(id))
}

pub fn failure(state: &TurnState) -> Option<Failure> {
    let error = state.step_error.as_ref().or(state.execution_error.as_ref())?;
    let error_type = text(error, "type").unwrap_or_default();
    if error_type == "provider.auth" {
        return Some(Failure::AuthRequired);
    }
    if error_type == "aborted" || error_type == "provider.content-filter" {
        return None;
    }
    Some(Failure::ServiceFailure {
        safe_message: text(error, "message")
            .filter(|message| !message.is_empty())
            .unwrap_or("OpenCode prompt failed")
            .to_owned(),
        service: Some("session".to_owned()),
        error_name: Some(error_type.to_owned()),
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
    let mut response = Map::new();
    let error = state.step_error.as_ref().or(state.execution_error.as_ref()).and_then(|error| text(error, "type"));
    response.insert("stopReason".to_owned(), json!(stop_reason(terminal, state.finish.as_deref(), error)));
    if let Some(usage) = &state.usage {
        let tokens = usage.turn;
        let mut out = Map::new();
        out.insert("inputTokens".to_owned(), number(tokens.input));
        out.insert("outputTokens".to_owned(), number(tokens.output));
        out.insert("totalTokens".to_owned(), number(tokens.total()));
        if tokens.reasoning > 0.0 {
            out.insert("thoughtTokens".to_owned(), number(tokens.reasoning));
        }
        if tokens.cache_read > 0.0 {
            out.insert("cachedReadTokens".to_owned(), number(tokens.cache_read));
        }
        if tokens.cache_write > 0.0 {
            out.insert("cachedWriteTokens".to_owned(), number(tokens.cache_write));
        }
        response.insert("usage".to_owned(), Value::Object(out));
    }
    // Interruption clears the projected retry, so a retry pending at interrupt is reported here.
    let meta = match state.retries.get(session_id) {
        Some(retry) => json!({ (RETRY_META): retry }),
        None => json!({}),
    };
    response.insert("_meta".to_owned(), meta);
    Value::Object(response)
}

// Child compactions are left to the background consumer.
pub fn abandon(state: &mut TurnState, ctx: &TurnContext) -> Folded {
    let mut outputs: Vec<Output> = std::mem::take(&mut state.tools)
        .values()
        .flat_map(|tool| {
            let mut update = error_tool_update(
                &tool.id,
                &tool.name,
                &tool.input,
                &json!([]),
                Some(&tool.metadata),
                "Cancelled",
                &ctx.cwd,
            );
            tag(&mut update, "tool_call_update");
            route(ctx, state.children.get(&tool.session_id), update)
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

pub fn reasoning_message_id(message_id: &str, ordinal: &Value) -> String {
    format!("{message_id}:reasoning:{}", js_string(ordinal))
}

fn js_string(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => "undefined".to_owned(),
        other => other.to_string(),
    }
}

fn child_created(state: &mut TurnState, event: &Value, ctx: &TurnContext) -> Folded {
    let data = data(event);
    let Some(parent_id) = text(data, "parentID").filter(|id| !id.is_empty()) else {
        return Folded::default();
    };
    let parent = (parent_id != ctx.session_id).then(|| state.children.get(parent_id)).flatten();
    if parent.is_none() && parent_id != ctx.session_id {
        return Folded::default();
    }
    let child = child::Session {
        id: text(data, "sessionID").unwrap_or_default().to_owned(),
        parent_id: parent_id.to_owned(),
        depth: parent.map_or(1, |parent| parent.depth + 1),
        title: text(data, "title").map(str::to_owned),
    };
    let outputs = child_status(ctx, &child, child::status("created", None));
    state.open_children.insert(child.id.clone());
    state.children.insert(child.id.clone(), child);
    Folded::new(outputs)
}

fn root_event(state: &mut TurnState, event: &Value, ctx: &TurnContext) -> Folded {
    let data = data(event);
    match kind(event) {
        "session.step.started" => {
            state.step_error = None;
            session_event(state, event, ctx, None)
        }
        "session.step.ended" => {
            record_step(state, data.get("tokens"));
            state.finish = text(data, "finish").map(str::to_owned);
            Folded::default()
        }
        "session.step.failed" => {
            if let Some(tokens) = data.get("tokens").filter(|tokens| !tokens.is_null()) {
                record_step(state, Some(tokens));
            }
            state.step_error = data.get("error").cloned();
            Folded::default()
        }
        "session.execution.succeeded" => terminal(Terminal::Succeeded),
        "session.execution.interrupted" => terminal(Terminal::Interrupted),
        "session.execution.failed" => {
            state.execution_error = data.get("error").cloned();
            terminal(Terminal::Failed)
        }
        _ => session_event(state, event, ctx, None),
    }
}

fn terminal(terminal: Terminal) -> Folded {
    Folded { outputs: Vec::new(), terminal: Some(terminal) }
}

fn child_event(state: &mut TurnState, event: &Value, ctx: &TurnContext, child: &child::Session) -> Folded {
    match kind(event) {
        "session.execution.started" => Folded::new(child_status(ctx, child, child::status("running", None))),
        "session.execution.succeeded" => child_ended(state, ctx, child, child::status("completed", None)),
        "session.execution.interrupted" => child_ended(state, ctx, child, child::status("interrupted", None)),
        "session.execution.failed" => {
            child_ended(state, ctx, child, child::status("failed", data(event).get("error").cloned()))
        }
        _ => session_event(state, event, ctx, Some(child)),
    }
}

fn tag(update: &mut Value, session_update: &str) {
    let Some(object) = update.as_object_mut() else {
        return;
    };
    let mut tagged = Map::new();
    tagged.insert("sessionUpdate".to_owned(), json!(session_update));
    tagged.extend(std::mem::take(object));
    *object = tagged;
}

fn session_event(state: &mut TurnState, event: &Value, ctx: &TurnContext, child: Option<&child::Session>) -> Folded {
    let data = data(event);
    let session_id = child.map_or(ctx.session_id.as_str(), |child| child.id.as_str());
    let send = |update: Value| route(ctx, child, update);
    let standard = compaction::uses_standard_updates(ctx.compaction, ctx.child_updates, child.is_some());
    match kind(event) {
        "session.step.started" => {
            if state.retries.remove(session_id).is_none() {
                return Folded::default();
            }
            Folded::new(send(json!({ "sessionUpdate": "session_info_update", "_meta": { (RETRY_META): null } })))
        }
        "session.retry.scheduled" => {
            let retry = json!({
                "attempt": data.get("attempt").cloned().unwrap_or(Value::Null),
                "nextRetryAt": iso_time(data.get("at")),
                "error": data.get("error").cloned().unwrap_or(Value::Null),
            });
            state.retries.insert(session_id.to_owned(), retry.clone());
            Folded::new(send(json!({ "sessionUpdate": "session_info_update", "_meta": { (RETRY_META): retry } })))
        }
        "session.compaction.started" | "session.compaction.ended" | "session.compaction.failed" => {
            let (tracked, updates) = compaction::apply(event, &state.compactions, standard);
            state.compactions = tracked;
            Folded::new(updates.into_iter().flat_map(send).collect())
        }
        "session.compaction.delta" => {
            let update =
                compaction::chunk(state.compactions.get(session_id), text(data, "text").unwrap_or_default(), standard);
            Folded::new(update.map(send).unwrap_or_default())
        }
        "session.text.delta" => Folded::new(send(json!({
            "sessionUpdate": "agent_message_chunk",
            "messageId": data.get("assistantMessageID").cloned().unwrap_or(Value::Null),
            "content": { "type": "text", "text": data.get("delta").cloned().unwrap_or(Value::Null) },
        }))),
        "session.reasoning.delta" => Folded::new(send(json!({
            "sessionUpdate": "agent_thought_chunk",
            "messageId": reasoning_message_id(
                text(data, "assistantMessageID").unwrap_or_default(),
                data.get("ordinal").unwrap_or(&Value::Null),
            ),
            "content": { "type": "text", "text": data.get("delta").cloned().unwrap_or(Value::Null) },
        }))),
        "session.tool.input.started" => {
            let tool_session = text(data, "sessionID").unwrap_or_default();
            let id = text(data, "id").unwrap_or_default();
            let name = text(data, "name").unwrap_or("tool");
            state.tools.insert(tool_key(tool_session, id), new_tool(tool_session, id, Some(name)));
            let mut update = pending_tool_call(id, name, &json!({}), None, &ctx.cwd);
            tag(&mut update, "tool_call");
            Folded::new(send(update))
        }
        "session.tool.called" => {
            let tool_session = text(data, "sessionID").unwrap_or_default();
            let id = text(data, "id").unwrap_or_default();
            let tool =
                state.tools.entry(tool_key(tool_session, id)).or_insert_with(|| new_tool(tool_session, id, None));
            tool.input = data.get("input").cloned().unwrap_or_else(|| json!({}));
            let mut update = running_tool_update(id, &tool.name, &tool.input, &ctx.cwd);
            tag(&mut update, "tool_call_update");
            Folded::new(send(update))
        }
        "session.tool.progress" => {
            let id = text(data, "id").unwrap_or_default();
            let Some(tool) = state.tools.get_mut(&tool_key(text(data, "sessionID").unwrap_or_default(), id)) else {
                return Folded::default();
            };
            tool.metadata = data.get("metadata").cloned().unwrap_or(Value::Null);
            let mut update = running_tool_update(id, &tool.name, &tool.input, &ctx.cwd);
            tag(&mut update, "tool_call_update");
            Folded::new(send(update))
        }
        "session.tool.success" => {
            let tool_session = text(data, "sessionID").unwrap_or_default();
            let id = text(data, "id").unwrap_or_default();
            let tool = state
                .tools
                .shift_remove(&tool_key(tool_session, id))
                .unwrap_or_else(|| new_tool(tool_session, id, None));
            let metadata = data.get("metadata").filter(|value| !value.is_null());
            let mut update = completed_tool_update(
                id,
                &tool.name,
                &tool.input,
                data.get("content").unwrap_or(&json!([])),
                metadata,
                &ctx.cwd,
            );
            tag(&mut update, "tool_call_update");
            let source = DiffSource { tool_name: tool.name, input: tool.input, metadata: metadata.cloned() };
            Folded::new(send(update).into_iter().map(|output| with_diff(output, &source)).collect())
        }
        "session.tool.failed" => {
            let tool_session = text(data, "sessionID").unwrap_or_default();
            let id = text(data, "id").unwrap_or_default();
            let tool = state
                .tools
                .shift_remove(&tool_key(tool_session, id))
                .unwrap_or_else(|| new_tool(tool_session, id, None));
            let metadata = data.get("metadata").filter(|value| !value.is_null()).unwrap_or(&tool.metadata);
            let content = data.get("content").filter(|value| !value.is_null()).cloned().unwrap_or_else(|| json!([]));
            let error = data.get("error").and_then(|error| text(error, "message")).unwrap_or_default();
            let mut update = error_tool_update(id, &tool.name, &tool.input, &content, Some(metadata), error, &ctx.cwd);
            tag(&mut update, "tool_call_update");
            Folded::new(send(update))
        }
        _ => Folded::default(),
    }
}

fn with_diff(output: Output, source: &DiffSource) -> Output {
    match output {
        Output::SessionUpdate { update, .. } => Output::SessionUpdate { update, diff: Some(source.clone()) },
        Output::ChildUpdate { update, .. } => Output::ChildUpdate { update, diff: Some(source.clone()) },
        other => other,
    }
}

fn iso_time(at: Option<&Value>) -> Value {
    let millis = at.and_then(Value::as_f64).unwrap_or_default();
    #[allow(clippy::cast_possible_truncation)]
    match chrono::DateTime::from_timestamp_millis(millis as i64) {
        Some(time) => json!(time.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()),
        None => Value::Null,
    }
}

fn new_tool(session_id: &str, id: &str, name: Option<&str>) -> Tool {
    Tool {
        session_id: session_id.to_owned(),
        id: id.to_owned(),
        name: name.unwrap_or("tool").to_owned(),
        input: json!({}),
        metadata: json!({}),
    }
}

fn route(ctx: &TurnContext, child: Option<&child::Session>, update: Value) -> Vec<Output> {
    let Some(child) = child else {
        return vec![Output::SessionUpdate { update, diff: None }];
    };
    let projected = child::project(update, child);
    if ctx.child_updates {
        return child_status(ctx, child, child::update_event(projected));
    }
    vec![Output::SessionUpdate { update: projected, diff: None }]
}

fn child_status(ctx: &TurnContext, child: &child::Session, event: Value) -> Vec<Output> {
    if !ctx.child_updates {
        return Vec::new();
    }
    vec![Output::ChildUpdate { update: child::update(&ctx.session_id, child, event), diff: None }]
}

fn child_ended(state: &mut TurnState, ctx: &TurnContext, child: &child::Session, status: Value) -> Folded {
    state.open_children.remove(&child.id);
    Folded::new(child_status(ctx, child, status))
}

fn record_step(state: &mut TurnState, tokens: Option<&Value>) {
    let tokens = Tokens::from_json(tokens.unwrap_or(&Value::Null));
    state.usage = Some(Usage { turn: state.usage.map_or(tokens, |usage| usage.turn.add(&tokens)), last: tokens });
}

fn session_id_from_event(event: &Value) -> Option<&str> {
    let data = data(event);
    if let Some(id) = text(data, "sessionID") {
        return Some(id);
    }
    if kind(event) == "form.created" {
        return data.get("form").and_then(|form| text(form, "sessionID"));
    }
    None
}

fn tool_key(session_id: &str, id: &str) -> String {
    format!("{session_id}:{id}")
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
