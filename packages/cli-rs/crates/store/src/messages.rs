//! Messages and parts (F.7): transcripts, the streaming event fold, and paged reads.

use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::Arc;

use opencode_api::client::RequestOptions;
use opencode_api::generated::*;
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::inbox::InboxExt;
use crate::state::{Data, Error, MESSAGE_PAGE, State, Task, evict_missing};

/// One session's loaded messages, oldest first, with an index by ID.
#[derive(Debug, Clone, Default)]
pub struct Transcript {
    items: Vec<SessionMessageInfo>,
    index: HashMap<String, usize>,
}

impl Transcript {
    pub(crate) fn new(items: Vec<SessionMessageInfo>) -> Self {
        let mut transcript = Self { items, index: HashMap::new() };
        transcript.reindex(0);
        transcript
    }

    pub fn items(&self) -> &[SessionMessageInfo] {
        &self.items
    }

    pub fn get(&self, id: &str) -> Option<&SessionMessageInfo> {
        self.index.get(id).map(|&position| &self.items[position])
    }

    pub fn contains(&self, id: &str) -> bool {
        self.index.contains_key(id)
    }

    pub(crate) fn get_mut(&mut self, id: &str) -> Option<&mut SessionMessageInfo> {
        let position = *self.index.get(id)?;
        self.items.get_mut(position)
    }

    pub(crate) fn items_mut(&mut self) -> &mut Vec<SessionMessageInfo> {
        &mut self.items
    }

    /// Appends unless the ID is present; reports whether it did.
    pub(crate) fn append(&mut self, item: SessionMessageInfo) -> bool {
        if self.index.contains_key(item.id()) {
            return false;
        }
        self.index.insert(item.id().to_owned(), self.items.len());
        self.items.push(item);
        true
    }

    /// Replaces the item with the same ID, or appends it.
    pub(crate) fn upsert(&mut self, item: SessionMessageInfo) {
        match self.index.get(item.id()) {
            Some(&position) => self.items[position] = item,
            None => {
                self.append(item);
            }
        }
    }

    pub(crate) fn remove(&mut self, id: &str) -> Option<SessionMessageInfo> {
        let position = self.index.remove(id)?;
        let item = self.items.remove(position);
        self.reindex(position);
        Some(item)
    }

    /// Moves the item to the end.
    pub(crate) fn move_last(&mut self, id: &str) {
        let Some(position) = self.index.get(id).copied() else {
            return;
        };
        let item = self.items.remove(position);
        self.items.push(item);
        self.reindex(position);
    }

    /// Drops every item from `position` on.
    pub(crate) fn truncate(&mut self, position: usize) {
        for item in self.items.drain(position..) {
            self.index.remove(item.id());
        }
    }

    fn reindex(&mut self, start: usize) {
        for (position, item) in self.items.iter().enumerate().skip(start) {
            self.index.insert(item.id().to_owned(), position);
        }
    }

    /// The last assistant message that has not completed (`activeAssistant`).
    pub(crate) fn active_assistant(&mut self) -> Option<&mut SessionMessageAssistant> {
        self.items.iter_mut().rev().find_map(|item| match item {
            SessionMessageInfo::Assistant(assistant) if assistant.time.completed.is_none() => Some(assistant),
            _ => None,
        })
    }
}

/// Fields every message member has.
pub trait MessageExt {
    /// The message ID; empty for an unknown member without one.
    fn id(&self) -> &str;
    fn created(&self) -> f64;
    fn set_created(&mut self, created: f64);
}

impl MessageExt for SessionMessageInfo {
    fn id(&self) -> &str {
        match self {
            Self::AgentSwitched(item) => item.id.as_str(),
            Self::ModelSwitched(item) => item.id.as_str(),
            Self::LocationSwitched(item) => item.id.as_str(),
            Self::User(item) => item.id.as_str(),
            Self::Synthetic(item) => item.id.as_str(),
            Self::System(item) => item.id.as_str(),
            Self::Skill(item) => item.id.as_str(),
            Self::Shell(item) => item.id.as_str(),
            Self::Assistant(item) => item.id.as_str(),
            Self::Compaction(SessionMessageCompaction::Running(item)) => item.id.as_str(),
            Self::Compaction(SessionMessageCompaction::Completed(item)) => item.id.as_str(),
            Self::Compaction(SessionMessageCompaction::Failed(item)) => item.id.as_str(),
            Self::Idle(item) => item.id.as_str(),
            Self::Compaction(SessionMessageCompaction::Unknown(value)) | Self::Unknown(value) => {
                value.get("id").and_then(Value::as_str).unwrap_or_default()
            }
        }
    }

    fn created(&self) -> f64 {
        match self {
            Self::AgentSwitched(item) => item.time.created,
            Self::ModelSwitched(item) => item.time.created,
            Self::LocationSwitched(item) => item.time.created,
            Self::User(item) => item.time.created,
            Self::Synthetic(item) => item.time.created,
            Self::System(item) => item.time.created,
            Self::Skill(item) => item.time.created,
            Self::Shell(item) => item.time.created,
            Self::Assistant(item) => item.time.created,
            Self::Compaction(SessionMessageCompaction::Running(item)) => item.time.created,
            Self::Compaction(SessionMessageCompaction::Completed(item)) => item.time.created,
            Self::Compaction(SessionMessageCompaction::Failed(item)) => item.time.created,
            Self::Idle(item) => item.time.created,
            Self::Compaction(SessionMessageCompaction::Unknown(value)) | Self::Unknown(value) => {
                value.pointer("/time/created").and_then(Value::as_f64).unwrap_or_default()
            }
        }
    }

    fn set_created(&mut self, created: f64) {
        match self {
            Self::AgentSwitched(item) => item.time.created = created,
            Self::ModelSwitched(item) => item.time.created = created,
            Self::LocationSwitched(item) => item.time.created = created,
            Self::User(item) => item.time.created = created,
            Self::Synthetic(item) => item.time.created = created,
            Self::System(item) => item.time.created = created,
            Self::Skill(item) => item.time.created = created,
            Self::Shell(item) => item.time.created = created,
            Self::Assistant(item) => item.time.created = created,
            Self::Compaction(SessionMessageCompaction::Running(item)) => item.time.created = created,
            Self::Compaction(SessionMessageCompaction::Completed(item)) => item.time.created = created,
            Self::Compaction(SessionMessageCompaction::Failed(item)) => item.time.created = created,
            Self::Idle(item) => item.time.created = created,
            Self::Compaction(SessionMessageCompaction::Unknown(value)) | Self::Unknown(value) => {
                if let Some(time) = value.get_mut("time").and_then(Value::as_object_mut) {
                    time.insert("created".into(), created.into());
                }
            }
        }
    }
}

/// `SessionMessage.ID.fromEvent`: the projected message of an event shares its ID.
pub(crate) fn from_event(id: &EventID) -> SessionMessageID {
    SessionMessageID(match id.as_str().strip_prefix("evt_") {
        Some(rest) => format!("msg_{rest}"),
        None => id.as_str().to_owned(),
    })
}

/// Empties inline `data:` file payloads, keeping `data:<mime>;base64,` so the item still says
/// what it was (`omitFileData`).
pub(crate) fn omit_file_data(content: &mut [ToolContent]) {
    for item in content {
        let ToolContent::File(file) = item else {
            continue;
        };
        if file.uri.starts_with("data:") {
            file.uri = format!("data:{};base64,", file.mime);
        }
    }
}

fn omit_message_file_data(message: &mut SessionMessageInfo) {
    let SessionMessageInfo::Assistant(assistant) = message else {
        return;
    };
    for part in &mut assistant.content {
        let SessionMessageAssistantContentItem::Tool(tool) = part else {
            continue;
        };
        match &mut tool.state {
            SessionMessageAssistantToolState::Completed(state) => omit_file_data(&mut state.content),
            SessionMessageAssistantToolState::Error(state) => {
                if let Some(content) = &mut state.content {
                    omit_file_data(content);
                }
            }
            _ => {}
        }
    }
}

/// Options of [`Data::message_load_more`].
#[derive(Debug, Clone, Default)]
pub struct LoadMore {
    /// Loads every older page in one publication.
    pub all: bool,
    /// Cancels the wait and the request (the TS `signal`).
    pub cancel: Option<CancellationToken>,
}

impl State {
    pub fn messages(&self, session: &SessionID) -> &[SessionMessageInfo] {
        self.messages.get(session).map(Transcript::items).unwrap_or_default()
    }

    pub fn transcript(&self, session: &SessionID) -> Option<&Transcript> {
        self.messages.get(session)
    }

    pub fn message(&self, session: &SessionID, message: &str) -> Option<&SessionMessageInfo> {
        self.messages.get(session)?.get(message)
    }

    /// True while older pages remain (`message.more`).
    pub fn has_more_messages(&self, session: &SessionID) -> bool {
        self.cursor.contains_key(session)
    }

    pub fn messages_loading(&self, session: &SessionID) -> bool {
        self.loading.contains(session)
    }

    pub(crate) fn stored(&self, mut message: SessionMessageInfo) -> SessionMessageInfo {
        if self.omit_file_data {
            omit_message_file_data(&mut message);
        }
        message
    }

    /// The transcript of `session`, created empty when missing (`draft[sessionID] ??= []`).
    pub(crate) fn transcript_mut(&mut self, session: &SessionID) -> &mut Transcript {
        self.messages.entry(session.clone()).or_default()
    }

    /// Appends `item` unless present (`message.insert`).
    pub(crate) fn insert_message(&mut self, session: &SessionID, item: SessionMessageInfo) {
        if self.transcript_mut(session).append(item) {
            self.log.messages(session);
        }
    }

    pub(crate) fn upsert_message(&mut self, session: &SessionID, item: SessionMessageInfo) {
        let id = SessionMessageID(item.id().to_owned());
        let transcript = self.transcript_mut(session);
        if transcript.contains(&id.0) {
            transcript.upsert(item);
            self.log.message(session, &id);
            return;
        }
        transcript.append(item);
        self.log.messages(session);
    }

    /// Edits one loaded assistant message; drops the edit when it is not loaded (`editAssistant`).
    pub(crate) fn edit_assistant(
        &mut self,
        session: &SessionID,
        message: &SessionMessageID,
        f: impl FnOnce(&mut SessionMessageAssistant),
    ) {
        let Some(SessionMessageInfo::Assistant(assistant)) =
            self.messages.get_mut(session).and_then(|transcript| transcript.get_mut(&message.0))
        else {
            return;
        };
        f(assistant);
        self.log.message(session, message);
    }

    /// Edits the latest tool part with `tool` (`editTool`).
    fn edit_tool(
        &mut self,
        session: &SessionID,
        message: &SessionMessageID,
        tool: &str,
        f: impl FnOnce(&mut SessionMessageAssistantTool),
    ) {
        self.edit_assistant(session, message, |assistant| {
            let part = assistant.content.iter_mut().rev().find_map(|part| match part {
                SessionMessageAssistantContentItem::Tool(part) if part.id == tool => Some(part),
                _ => None,
            });
            if let Some(part) = part {
                f(part);
            }
        });
    }

    /// Edits the latest text part (`editText`).
    fn edit_text(
        &mut self,
        session: &SessionID,
        message: &SessionMessageID,
        f: impl FnOnce(&mut SessionMessageAssistantText),
    ) {
        self.edit_assistant(session, message, |assistant| {
            let part = assistant.content.iter_mut().rev().find_map(|part| match part {
                SessionMessageAssistantContentItem::Text(part) => Some(part),
                _ => None,
            });
            if let Some(part) = part {
                f(part);
            }
        });
    }

    /// Edits the latest reasoning part that has not completed (`editReasoning`).
    fn edit_reasoning(
        &mut self,
        session: &SessionID,
        message: &SessionMessageID,
        f: impl FnOnce(&mut SessionMessageAssistantReasoning),
    ) {
        self.edit_assistant(session, message, |assistant| {
            let part = assistant.content.iter_mut().rev().find_map(|part| match part {
                SessionMessageAssistantContentItem::Reasoning(part)
                    if part.time.as_ref().is_none_or(|time| time.completed.is_none()) =>
                {
                    Some(part)
                }
                _ => None,
            });
            if let Some(part) = part {
                f(part);
            }
        });
    }

    pub(crate) fn on_step_started(&mut self, event: &SessionStepStarted) {
        let data = &event.data;
        let session = &data.session_id;
        let started = data.started as f64;
        let transcript = self.transcript_mut(session);
        if let Some(SessionMessageInfo::Assistant(existing)) = transcript.get_mut(&data.assistant_message_id.0) {
            existing.agent = data.agent.clone();
            existing.model = data.model.clone();
            existing.retry = None;
            existing.error = None;
            existing.finish = None;
            existing.raw_finish = None;
            existing.native = None;
            existing.time.created = started;
            existing.time.streamed = None;
            existing.time.completed = None;
            if let Some(snapshot) = &data.snapshot {
                existing.snapshot.get_or_insert_default().start = Some(snapshot.clone());
            }
            self.log.message(session, &data.assistant_message_id);
            return;
        }
        if let Some(current) = transcript.active_assistant() {
            current.retry = None;
            current.time.completed = Some(event.created);
            let id = current.id.clone();
            self.log.message(session, &id);
        }
        let assistant = SessionMessageAssistant {
            id: data.assistant_message_id.clone(),
            r#type: "assistant".into(),
            agent: data.agent.clone(),
            model: data.model.clone(),
            metadata: event.metadata.clone(),
            snapshot: data.snapshot.as_ref().map(|snapshot| SessionMessageAssistantSnapshot {
                start: Some(snapshot.clone()),
                ..Default::default()
            }),
            time: SessionMessageAssistantTime { created: started, ..Default::default() },
            ..Default::default()
        };
        self.insert_message(session, SessionMessageInfo::Assistant(assistant));
    }

    pub(crate) fn on_step_streamed(&mut self, event: &SessionStepStreamed) {
        let created = event.created;
        self.edit_assistant(&event.data.session_id, &event.data.assistant_message_id, |assistant| {
            assistant.time.streamed = Some(created)
        });
    }

    pub(crate) fn on_step_ended(&mut self, event: &SessionStepEnded) {
        let data = &event.data;
        self.edit_assistant(&data.session_id, &data.assistant_message_id, |assistant| {
            assistant.time.completed = Some(event.created);
            assistant.finish = Some(data.finish.clone());
            assistant.raw_finish = data.raw_finish.clone();
            assistant.native = data.native.clone();
            assistant.cost = Some(data.cost);
            assistant.tokens = Some(data.tokens.clone());
            if let Some(snapshot) = &data.snapshot {
                assistant.snapshot.get_or_insert_default().end = Some(snapshot.clone());
            }
        });
    }

    pub(crate) fn on_step_failed(&mut self, event: &SessionStepFailed) {
        let data = &event.data;
        self.edit_assistant(&data.session_id, &data.assistant_message_id, |assistant| {
            assistant.time.completed = Some(event.created);
            assistant.finish = Some(SessionMessageAssistantFinish::from(data.finish.as_deref().unwrap_or("error")));
            assistant.raw_finish = data.raw_finish.clone();
            assistant.native = data.native.clone();
            assistant.error = Some(data.error.clone());
            assistant.retry = None;
            if let (Some(cost), Some(tokens)) = (data.cost, &data.tokens) {
                assistant.cost = Some(cost);
                assistant.tokens = Some(tokens.clone());
            }
        });
    }

    pub(crate) fn on_text_started(&mut self, session: &SessionID, message: &SessionMessageID) {
        self.edit_assistant(session, message, |assistant| {
            assistant.content.push(SessionMessageAssistantContentItem::Text(SessionMessageAssistantText {
                r#type: "text".into(),
                ..Default::default()
            }));
        });
    }

    pub(crate) fn on_text_delta(&mut self, data: &SessionTextDeltaData) {
        self.edit_text(&data.session_id, &data.assistant_message_id, |text| text.text.push_str(&data.delta));
    }

    pub(crate) fn on_text_ended(&mut self, data: &SessionTextEndedData) {
        self.edit_text(&data.session_id, &data.assistant_message_id, |text| text.text.clone_from(&data.text));
    }

    pub(crate) fn on_reasoning_started(&mut self, event: &SessionReasoningStarted) {
        let data = &event.data;
        self.edit_assistant(&data.session_id, &data.assistant_message_id, |assistant| {
            assistant.content.push(SessionMessageAssistantContentItem::Reasoning(SessionMessageAssistantReasoning {
                r#type: "reasoning".into(),
                text: String::new(),
                native: data.native.clone(),
                time: Some(SessionMessageShellTime { created: event.created, completed: None }),
            }));
        });
    }

    pub(crate) fn on_reasoning_delta(&mut self, data: &SessionTextDeltaData) {
        self.edit_reasoning(&data.session_id, &data.assistant_message_id, |reasoning| {
            reasoning.text.push_str(&data.delta)
        });
    }

    pub(crate) fn on_reasoning_ended(&mut self, event: &SessionReasoningEnded) {
        let data = &event.data;
        self.edit_reasoning(&data.session_id, &data.assistant_message_id, |reasoning| {
            reasoning.text.clone_from(&data.text);
            reasoning.time = Some(SessionMessageShellTime {
                created: reasoning.time.as_ref().map_or(event.created, |time| time.created),
                completed: Some(event.created),
            });
            if data.native.is_some() {
                reasoning.native = data.native.clone();
            }
        });
    }

    pub(crate) fn on_tool_input_started(&mut self, event: &SessionToolInputStarted) {
        let data = &event.data;
        self.edit_assistant(&data.session_id, &data.assistant_message_id, |assistant| {
            assistant.content.push(SessionMessageAssistantContentItem::Tool(SessionMessageAssistantTool {
                r#type: "tool".into(),
                id: data.id.clone(),
                name: data.name.clone(),
                executed: None,
                native: None,
                time: SessionMessageAssistantToolTime { created: event.created, ..Default::default() },
                state: SessionMessageAssistantToolState::Streaming(SessionMessageToolStateStreaming {
                    status: "streaming".into(),
                    input: String::new(),
                }),
            }));
        });
    }

    pub(crate) fn on_tool_input_delta(&mut self, data: &SessionToolInputDeltaData) {
        self.edit_tool(&data.session_id, &data.assistant_message_id, &data.id, |tool| {
            if let SessionMessageAssistantToolState::Streaming(state) = &mut tool.state {
                state.input.push_str(&data.delta);
            }
        });
    }

    pub(crate) fn on_tool_input_ended(&mut self, data: &SessionToolInputEndedData) {
        self.edit_tool(&data.session_id, &data.assistant_message_id, &data.id, |tool| {
            if let SessionMessageAssistantToolState::Streaming(state) = &mut tool.state {
                state.input.clone_from(&data.text);
            }
        });
    }

    pub(crate) fn on_tool_called(&mut self, event: &SessionToolCalled) {
        let data = &event.data;
        self.edit_tool(&data.session_id, &data.assistant_message_id, &data.id, |tool| {
            tool.time.ran = Some(event.created);
            tool.executed = Some(data.executed);
            tool.native = data.native.clone();
            tool.state = SessionMessageAssistantToolState::Running(SessionMessageToolStateRunning {
                status: "running".into(),
                input: data.input.clone(),
                metadata: Default::default(),
            });
        });
    }

    pub(crate) fn on_tool_progress(&mut self, data: &SessionToolProgressData) {
        self.edit_tool(&data.session_id, &data.assistant_message_id, &data.id, |tool| {
            if let SessionMessageAssistantToolState::Running(state) = &mut tool.state {
                state.metadata.clone_from(&data.metadata);
            }
        });
    }

    pub(crate) fn on_tool_success(&mut self, event: &SessionToolSuccess) {
        let data = &event.data;
        let omit = self.omit_file_data;
        self.edit_tool(&data.session_id, &data.assistant_message_id, &data.id, |tool| {
            let SessionMessageAssistantToolState::Running(state) = &tool.state else {
                return;
            };
            let mut content = data.content.clone();
            if omit {
                omit_file_data(&mut content);
            }
            tool.state = SessionMessageAssistantToolState::Completed(SessionMessageToolStateCompleted {
                status: "completed".into(),
                input: state.input.clone(),
                metadata: data.metadata.clone(),
                content,
            });
            tool.executed = Some(data.executed || tool.executed == Some(true));
            merge_native(&mut tool.native, &data.native);
            tool.time.completed = Some(event.created);
        });
    }

    pub(crate) fn on_tool_failed(&mut self, event: &SessionToolFailed) {
        let data = &event.data;
        let omit = self.omit_file_data;
        self.edit_tool(&data.session_id, &data.assistant_message_id, &data.id, |tool| {
            let input = match &tool.state {
                SessionMessageAssistantToolState::Streaming(_) => Default::default(),
                SessionMessageAssistantToolState::Running(state) => state.input.clone(),
                _ => return,
            };
            let mut content = data.content.clone();
            if omit && let Some(content) = &mut content {
                omit_file_data(content);
            }
            tool.state = SessionMessageAssistantToolState::Error(SessionMessageToolStateError {
                status: "error".into(),
                error: data.error.clone(),
                input,
                metadata: data.metadata.clone(),
                content,
            });
            tool.executed = Some(data.executed || tool.executed == Some(true));
            merge_native(&mut tool.native, &data.native);
            tool.time.completed = Some(event.created);
        });
    }

    pub(crate) fn on_retry_scheduled(&mut self, data: &SessionRetryScheduledData) {
        self.edit_assistant(&data.session_id, &data.assistant_message_id, |assistant| {
            assistant.retry = Some(SessionMessageAssistantRetry {
                attempt: data.attempt,
                at: data.at as f64,
                error: data.error.clone(),
            });
        });
    }

    /// Clears the retry notice of the active assistant message.
    pub(crate) fn clear_retry(&mut self, session: &SessionID) {
        let Some(current) = self.transcript_mut(session).active_assistant() else {
            return;
        };
        if current.retry.take().is_some() {
            let id = current.id.clone();
            self.log.message(session, &id);
        }
    }

    /// True when a loaded assistant message still has a streaming or running tool.
    pub(crate) fn has_live_tool(&self, session: &SessionID) -> bool {
        self.messages(session).iter().any(|item| {
            let SessionMessageInfo::Assistant(assistant) = item else {
                return false;
            };
            assistant.content.iter().any(|part| {
                matches!(
                    part,
                    SessionMessageAssistantContentItem::Tool(SessionMessageAssistantTool {
                        state: SessionMessageAssistantToolState::Streaming(_)
                            | SessionMessageAssistantToolState::Running(_),
                        ..
                    })
                )
            })
        })
    }

    pub(crate) fn on_shell_started(&mut self, event: &SessionShellStarted) {
        let shell = &event.data.shell;
        let mut metadata = event.metadata.clone();
        if shell.metadata.get("background") == Some(&Value::Bool(true)) {
            metadata.get_or_insert_default().insert("background".into(), Value::Bool(true));
        }
        let message = SessionMessageShell {
            id: from_event(&event.id),
            r#type: "shell".into(),
            shell_id: shell.id.clone(),
            command: shell.command.clone(),
            status: shell.status.clone(),
            exit: shell.exit.map(SessionMessageShellExit::Number),
            metadata,
            output: None,
            time: SessionMessageShellTime { created: event.created, completed: None },
        };
        self.insert_message(&event.data.session_id, SessionMessageInfo::Shell(message));
    }

    pub(crate) fn on_shell_ended(&mut self, event: &SessionShellEnded) {
        let session = &event.data.session_id;
        let Some(transcript) = self.messages.get_mut(session) else {
            return;
        };
        let Some(shell) = transcript.items_mut().iter_mut().rev().find_map(|item| match item {
            SessionMessageInfo::Shell(shell) if shell.shell_id == event.data.shell.id => Some(shell),
            _ => None,
        }) else {
            return;
        };
        shell.status = event.data.shell.status.clone();
        shell.exit = event.data.shell.exit.map(SessionMessageShellExit::Number);
        shell.output = Some(event.data.output.clone());
        shell.time.completed = Some(event.created);
        let id = shell.id.clone();
        self.log.message(session, &id);
    }

    /// `session.revert.committed`: drops messages at or after the boundary.
    pub(crate) fn revert_messages(&mut self, session: &SessionID, to: &SessionMessageID) {
        let transcript = self.transcript_mut(session);
        let Some(position) = transcript.items().iter().position(|item| item.id() >= to.as_str()) else {
            return;
        };
        transcript.truncate(position);
        self.log.messages(session);
    }

    pub(crate) fn on_compaction_delta(&mut self, data: &SessionCompactionDeltaData) {
        let session = &data.session_id;
        let Some(transcript) = self.messages.get_mut(session) else {
            return;
        };
        let Some(running) = running_compaction(transcript) else {
            return;
        };
        let SessionMessageInfo::Compaction(SessionMessageCompaction::Running(current)) =
            &mut transcript.items_mut()[running]
        else {
            return;
        };
        current.summary.push_str(&data.text);
        let id = current.id.clone();
        self.log.message(session, &id);
    }

    pub(crate) fn on_compaction_ended(&mut self, event: &SessionCompactionEnded) {
        let data = &event.data;
        let session = &data.session_id;
        let transcript = self.transcript_mut(session);
        let completed = |id: SessionMessageID, metadata, time| {
            SessionMessageInfo::Compaction(SessionMessageCompaction::Completed(SessionMessageCompactionCompleted {
                r#type: "compaction".into(),
                id,
                metadata,
                time,
                status: "completed".into(),
                reason: data.reason.clone(),
                model: data.model.clone(),
                native: data.native.clone(),
                summary: data.text.clone(),
                cost: data.cost,
                tokens: data.tokens.clone(),
            }))
        };
        if let Some(position) = running_compaction(transcript) {
            let SessionMessageInfo::Compaction(SessionMessageCompaction::Running(current)) =
                &transcript.items()[position]
            else {
                return;
            };
            let id = current.id.clone();
            let next = completed(id.clone(), current.metadata.clone(), current.time.clone());
            transcript.items_mut()[position] = next;
            self.log.message(session, &id);
            return;
        }
        let item = completed(from_event(&event.id), None, SessionInboxUserTime { created: event.created });
        self.insert_message(session, item);
    }

    pub(crate) fn on_compaction_failed(&mut self, event: &SessionCompactionFailed) {
        let data = &event.data;
        let session = &data.session_id;
        let transcript = self.transcript_mut(session);
        let running = running_compaction(transcript).and_then(|position| match &transcript.items()[position] {
            SessionMessageInfo::Compaction(SessionMessageCompaction::Running(current)) => {
                Some((position, current.clone()))
            }
            _ => None,
        });
        let failed = |id, metadata, time| {
            SessionMessageInfo::Compaction(SessionMessageCompaction::Failed(SessionMessageCompactionFailed {
                r#type: "compaction".into(),
                id,
                metadata,
                time,
                status: "failed".into(),
                reason: data.reason.clone(),
                error: data.error.clone(),
                cost: data.cost,
                tokens: data.tokens.clone(),
            }))
        };
        if let Some((position, current)) = running {
            transcript.items_mut()[position] = failed(current.id.clone(), current.metadata, current.time);
            self.log.message(session, &current.id);
            return;
        }
        let id = data.input_id.clone().unwrap_or_else(|| from_event(&event.id));
        let item = failed(id, event.metadata.clone(), SessionInboxUserTime { created: event.created });
        self.insert_message(session, item);
    }
}

fn running_compaction(transcript: &Transcript) -> Option<usize> {
    transcript
        .items()
        .iter()
        .rposition(|item| matches!(item, SessionMessageInfo::Compaction(SessionMessageCompaction::Running(_))))
}

fn merge_native(target: &mut Option<SessionMessageNative>, next: &Option<SessionMessageNative>) {
    if let Some(next) = next {
        target.get_or_insert_default().extend(next.iter().map(|(key, value)| (key.clone(), value.clone())));
    }
}

impl Data {
    /// Reads the newest page of a transcript once per invalidation (`message.sync`).
    pub fn message_sync(&self, session: &SessionID) -> Task<()> {
        let session = session.clone();
        let limit = self.inner.options.initial_message_limit.unwrap_or(MESSAGE_PAGE);
        self.sync_start(
            format!("session.message:{}", session.0),
            |state| state.deletion_epoch,
            move |data, started| async move {
                let input = MessageListInput {
                    session_id: session.clone(),
                    limit: Some(limit),
                    order: Some(MessageListInputOrder::Desc),
                    ..Default::default()
                };
                let response = data
                    .client()
                    .message_list(&input, &RequestOptions::default())
                    .await
                    .map_err(|error| evict_missing(&data, error))?;
                data.write(|state| {
                    if state.deleted_since(&session, started) {
                        return;
                    }
                    let fetched: Vec<_> = response.data.into_iter().rev().map(|item| state.stored(item)).collect();
                    // A read racing an admission must not wipe its local transcript row.
                    let ids: HashSet<&str> = fetched.iter().map(MessageExt::id).collect();
                    let admitted: HashSet<&str> = state
                        .pending
                        .get(&session)
                        .into_iter()
                        .flatten()
                        .filter(|item| matches!(item.tag(), "user" | "synthetic"))
                        .map(|item| item.id())
                        .collect();
                    let local: Vec<_> = state
                        .messages(&session)
                        .iter()
                        .filter(|item| {
                            !ids.contains(item.id())
                                && (state.outbox.contains(item.id()) || admitted.contains(item.id()))
                        })
                        .cloned()
                        .collect();
                    let mut messages = fetched;
                    messages.extend(local);
                    state.messages.insert(session.clone(), Transcript::new(messages));
                    match response.cursor.next.flatten() {
                        Some(next) => state.cursor.insert(session.clone(), next),
                        None => state.cursor.remove(&session),
                    };
                    state.log.messages(&session);
                });
                Ok(())
            },
        )
    }

    pub fn message_invalidate(&self, session: &SessionID) {
        self.write(|state| state.syncs.invalidate(&format!("session.message:{}", session.0)));
    }

    /// Loads older pages (`message.loadMore`). Joins a load in flight; with `all`, it then
    /// continues to the oldest page.
    pub async fn message_load_more(&self, session: &SessionID, options: LoadMore) -> Result<(), Error> {
        let cancelled = || options.cancel.as_ref().is_some_and(|token| token.is_cancelled());
        if cancelled() {
            return Ok(());
        }
        loop {
            let Some(pending) = self.read(|state| state.message_loads.get(session).map(|(_, task)| task.clone()))
            else {
                break;
            };
            let published = match &options.cancel {
                None => pending.await?,
                Some(token) => tokio::select! {
                    result = pending => match result {
                        Ok(published) => published,
                        Err(_) if token.is_cancelled() => return Ok(()),
                        Err(error) => return Err(error),
                    },
                    _ = token.cancelled() => return Ok(()),
                },
            };
            if (!options.all && published) || cancelled() {
                return Ok(());
            }
        }
        if cancelled() {
            return Ok(());
        }
        match self.start_load(session, options) {
            Some(task) => task.await.map(|_| ()),
            None => Ok(()),
        }
    }

    /// Starts an older-page load from the current cursor, if any, and registers it for joiners.
    fn start_load(&self, session: &SessionID, options: LoadMore) -> Option<Task<bool>> {
        let mut state = self.lock();
        let cursor = state.cursor.get(session).cloned()?;
        state.loading.insert(session.clone());
        state.log.messages(session);
        let token = state.token();
        let data = self.clone();
        let id = session.clone();
        let all = options.all;
        let cancel = options.cancel.clone();
        let task = self.spawn(async move {
            let result = load_pages(&data, &id, cursor, all, cancel.as_ref()).await;
            data.write(|state| {
                state.loading.remove(&id);
                state.log.messages(&id);
                if state.message_loads.get(&id).is_some_and(|(current, _)| *current == token) {
                    state.message_loads.remove(&id);
                }
            });
            match result {
                Err(_) if cancel.as_ref().is_some_and(CancellationToken::is_cancelled) => Ok(false),
                result => result,
            }
        });
        state.message_loads.insert(session.clone(), (token, task.clone()));
        self.flush(&mut state);
        Some(task)
    }
}

/// Fetches older pages and publishes them once; false when cancelled before publishing.
async fn load_pages(
    data: &Data,
    session: &SessionID,
    cursor: String,
    all: bool,
    cancel: Option<&CancellationToken>,
) -> Result<bool, Error> {
    let mut fetched = Vec::new();
    let mut next = Some(cursor);
    while let Some(cursor) = next {
        let input = MessageListInput {
            session_id: session.clone(),
            limit: Some(if all { 200 } else { MESSAGE_PAGE }),
            cursor: Some(cursor),
            ..Default::default()
        };
        let options = RequestOptions::default();
        let request = data.client().message_list(&input, &options);
        let response = match cancel {
            None => request.await,
            Some(token) => tokio::select! {
                response = request => response,
                _ = token.cancelled() => return Ok(false),
            },
        }
        .map_err(Arc::new)?;
        if cancel.is_some_and(CancellationToken::is_cancelled) {
            return Ok(false);
        }
        fetched.extend(response.data);
        next = response.cursor.next.flatten();
        if !all {
            break;
        }
    }
    data.write(|state| {
        let fetched: Vec<_> = fetched.into_iter().map(|item| state.stored(item)).collect();
        let transcript = state.transcript_mut(session);
        let ids: HashSet<String> = transcript.items().iter().map(|item| item.id().to_owned()).collect();
        let mut messages: Vec<_> = fetched.into_iter().rev().filter(|item| !ids.contains(item.id())).collect();
        messages.extend(transcript.items().iter().cloned());
        *transcript = Transcript::new(messages);
        match &next {
            Some(next) => state.cursor.insert(session.clone(), next.clone()),
            None => state.cursor.remove(session),
        };
        state.log.messages(session);
    });
    Ok(true)
}
