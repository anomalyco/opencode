//! The session transcript as scrollback commits (`stream-v2.transport.ts`, `stream-v2.fragment.ts`): hydration
//! from the message list, live events, and replay on resume and resize.
//!
//! [`Transcript`] is a plain state machine on the UI thread: it turns messages and events into [`Commit`]s and
//! remembers what it already showed, so a message that arrives both live and in a later list prints once. The
//! network side ([`connect`], [`messages`]) runs on tokio and posts what it reads to the UI thread.
//!
//! Tools, shells, subagents, permissions, and forms reach this module but are drawn by M.3 and M.4: tool parts go
//! through [`crate::tools::commits`], and requests through [`crate::footers`].

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use opencode_api::client::Client;
use opencode_api::generated::{
    EventSubscribeInput, ExperimentalSessionWaitInput, LocationQueryInput, MessageListInput, MessageListInputOrder,
    ModelDefaultInput, SessionID, SessionInterruptInput,
};
use opencode_api::transport::SseResponse;
use opentui::app::ProxyError;
use opentui::prelude::*;
use serde_json::Value;

use crate::scrollback::{Commit, EntryKind, Phase, Source};

/// `--replay-limit`'s default: the newest messages a replay lists.
pub const DEFAULT_REPLAY_LIMIT: u32 = 200;
/// `LOCAL_REPLAY_ROW_LIMIT`: rows printed only locally (errors, prompts in flight) that a resize replays.
pub const LOCAL_ROW_LIMIT: usize = 100;
/// `RESIZE_DELAY`.
pub const RESIZE_DELAY: Duration = Duration::from_millis(250);

/// A part of a message whose text arrives in pieces (`FragmentRef`).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Fragment {
    pub message_id: String,
    pub part_id: String,
}

impl Fragment {
    /// `fragmentRef`.
    pub fn new(message_id: &str, kind: &str, ordinal: u64) -> Self {
        Self { message_id: message_id.to_owned(), part_id: format!("{kind}:{ordinal}") }
    }
}

#[derive(Clone, Debug, Default)]
struct FragmentState {
    text: String,
    /// Text a list already showed that a live delta may repeat.
    projected: Option<String>,
}

/// What a fragment held before an update.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Update {
    pub previous: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Restore {
    Append(String),
    Covered,
    Conflict,
}

/// `createFragmentReconciler`.
#[derive(Clone, Debug, Default)]
pub struct Fragments(HashMap<Fragment, FragmentState>);

impl Fragments {
    pub fn clear(&mut self) {
        self.0.clear();
    }

    pub fn value(&self, fragment: &Fragment) -> Option<&str> {
        self.0.get(fragment).map(|state| state.text.as_str())
    }

    /// The fragment's whole text from a list; `visible` when it was shown.
    pub fn project(&mut self, fragment: &Fragment, text: &str, visible: bool) -> Update {
        let current = self.0.remove(fragment).unwrap_or_default();
        self.0.insert(
            fragment.clone(),
            FragmentState {
                text: text.to_owned(),
                projected: if visible { Some(text.to_owned()) } else { current.projected },
            },
        );
        Update { previous: current.text }
    }

    /// A live delta; `None` when a list already showed it.
    pub fn delta(&mut self, fragment: &Fragment, delta: &str) -> Option<Update> {
        let state = self.0.entry(fragment.clone()).or_default();
        // Replay may start after an unseen prefix, so a covered chunk is consumed from anywhere in the projection.
        if let Some(projected) = &state.projected
            && let Some(at) = projected.find(delta)
        {
            state.projected = Some(projected[at + delta.len()..].to_owned());
            return None;
        }
        let previous = state.text.clone();
        state.text.push_str(delta);
        Some(Update { previous })
    }

    /// The final text of a fragment.
    pub fn end(&mut self, fragment: &Fragment, text: &str) -> Update {
        let previous = self
            .0
            .insert(fragment.clone(), FragmentState { text: text.to_owned(), projected: None })
            .map(|state| state.text)
            .unwrap_or_default();
        Update { previous }
    }

    /// A locally printed text, replayed after the list (`restore`).
    pub fn restore(&mut self, fragment: &Fragment, text: &str) -> Restore {
        let Some(current) = self.0.get(fragment) else {
            self.0.insert(fragment.clone(), FragmentState { text: text.to_owned(), projected: Some(text.to_owned()) });
            return Restore::Append(text.to_owned());
        };
        if let Some(suffix) = text.strip_prefix(current.text.as_str()) {
            let suffix = suffix.to_owned();
            self.0.insert(fragment.clone(), FragmentState { text: text.to_owned(), projected: Some(text.to_owned()) });
            return Restore::Append(suffix);
        }
        if current.text.starts_with(text) {
            return Restore::Covered;
        }
        Restore::Conflict
    }
}

/// A change to the footer's status (`FooterPatch`), as the transcript reports it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Patch {
    pub running: Option<bool>,
    pub status: Option<String>,
    pub usage: Option<Option<Usage>>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Usage {
    pub tokens: u64,
    pub percent: Option<u64>,
    pub cost: Option<f64>,
}

/// What one message or event produced.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Output {
    pub commits: Vec<Commit>,
    pub patch: Option<Patch>,
    /// `session.renamed`.
    pub title: Option<String>,
    /// Events for the footer views of M.3 (permissions, forms, subagents, the queue).
    pub footer: Vec<Value>,
}

impl Output {
    fn commits(commits: Vec<Commit>) -> Self {
        Self { commits, ..Self::default() }
    }

    fn patch(running: bool, status: &str) -> Self {
        Self {
            patch: Some(Patch { running: Some(running), status: Some(status.to_owned()), usage: None }),
            ..Self::default()
        }
    }

    pub fn extend(&mut self, other: Output) {
        self.commits.extend(other.commits);
        if other.patch.is_some() {
            self.patch = other.patch;
        }
        if other.title.is_some() {
            self.title = other.title;
        }
        self.footer.extend(other.footer);
    }
}

/// A prompt admitted to the inbox but not yet delivered.
#[derive(Clone, Debug, PartialEq)]
struct Pending {
    text: String,
}

/// The transcript of one session (the state of `createSessionTransport`).
#[derive(Debug)]
pub struct Transcript {
    pub session_id: String,
    pub thinking: bool,
    pub tools: bool,
    pub replay: bool,
    pub replay_limit: u32,
    /// The first hydration has not happened yet; its rows are not remembered locally.
    pub initial: bool,
    pub connected: bool,
    pub root_active: bool,
    message_ids: HashSet<String>,
    errors: HashSet<String>,
    fragments: Fragments,
    pending: HashMap<String, Pending>,
    promoted: HashSet<String>,
    /// Events that arrive while a resize replay lists the messages again.
    buffered: Option<Vec<Value>>,
    /// Rows printed only locally, newest last (`localRows`).
    local: Vec<Commit>,
    /// With tools hidden, a message's text waits for its step to end, and is dropped when the message turns out
    /// to call tools (`quietText`, `toolMessages`).
    quiet: Vec<(String, Vec<(String, String)>)>,
    tool_messages: HashSet<String>,
}

impl Transcript {
    pub fn new(session_id: &str, thinking: bool, tools: bool, replay: bool, replay_limit: Option<u32>) -> Self {
        Self {
            session_id: session_id.to_owned(),
            thinking,
            tools,
            replay,
            replay_limit: replay_limit.unwrap_or(DEFAULT_REPLAY_LIMIT),
            initial: true,
            connected: false,
            root_active: false,
            message_ids: HashSet::new(),
            errors: HashSet::new(),
            fragments: Fragments::default(),
            pending: HashMap::new(),
            promoted: HashSet::new(),
            buffered: None,
            local: Vec::new(),
            quiet: Vec::new(),
            tool_messages: HashSet::new(),
        }
    }

    /// The first or a reconnecting hydration (`hydrate`): every listed message, shown unless this is the first
    /// hydration and replay is off.
    pub fn hydrate(&mut self, messages: &[Value], active: bool) -> Output {
        let render = !self.initial || self.replay;
        let mut output = Output::default();
        for message in messages {
            output.extend(self.message(message, render));
        }
        self.root_active = active;
        self.initial = false;
        self.connected = true;
        output.patch = Some(Patch {
            running: Some(active),
            status: Some(if active { "assistant responding" } else { "" }.to_owned()),
            usage: None,
        });
        output
    }

    /// Starts a resize replay: events wait until [`Self::replayed`].
    pub fn begin_replay(&mut self) {
        self.buffered.get_or_insert_with(Vec::new);
    }

    pub fn replaying(&self) -> bool {
        self.buffered.is_some()
    }

    /// Ends a resize replay (`performResizeReplay`) after the terminal was cleared: the listed messages, then the
    /// rows only this client printed, then the events that waited.
    pub fn replayed(&mut self, messages: &[Value], active: bool) -> Output {
        let buffered = self.buffered.take().unwrap_or_default();
        self.message_ids.clear();
        self.errors.clear();
        self.fragments.clear();
        let mut output = Output::default();
        let local = std::mem::take(&mut self.local);
        output.extend(self.hydrate(messages, active));
        let mut restored = Vec::new();
        for commit in &local {
            if let Some(commit) = self.restore(commit) {
                restored.push(commit);
            }
        }
        output.commits.extend(restored);
        self.local = local;
        for event in &buffered {
            output.extend(self.event(event));
        }
        output
    }

    /// Ends a resize replay that could not list the messages: nothing was cleared, so only the events that waited
    /// apply.
    pub fn abort_replay(&mut self) -> Output {
        let mut output = Output::default();
        for event in self.buffered.take().unwrap_or_default() {
            output.extend(self.event(&event));
        }
        output
    }

    fn restore(&mut self, commit: &Commit) -> Option<Commit> {
        if let (Some(message), Some(part), EntryKind::Assistant | EntryKind::Reasoning) =
            (&commit.message_id, &commit.part_id, commit.kind)
        {
            let prefix = if commit.kind == EntryKind::Reasoning { "Thinking: " } else { "" };
            let text = commit.text.strip_prefix(prefix).unwrap_or(&commit.text);
            let fragment = Fragment { message_id: message.clone(), part_id: part.clone() };
            return match self.fragments.restore(&fragment, text) {
                Restore::Covered => None,
                Restore::Append(suffix) if suffix.is_empty() => None,
                Restore::Append(suffix) if suffix == text => Some(commit.clone()),
                Restore::Append(suffix) => Some(Commit { text: suffix, ..commit.clone() }),
                Restore::Conflict => Some(commit.clone()),
            };
        }
        if commit.kind == EntryKind::Error
            && let Some(message) = &commit.message_id
        {
            return self.errors.insert(message.clone()).then(|| commit.clone());
        }
        if commit.message_id.as_ref().is_some_and(|message| self.message_ids.contains(message)) {
            return None;
        }
        Some(commit.clone())
    }

    /// Remembers rows this client printed itself, for a resize replay (`rememberLocal`).
    pub fn remember(&mut self, commit: &Commit) {
        let joins = self.local.last().is_some_and(|last| {
            matches!(commit.kind, EntryKind::Assistant | EntryKind::Reasoning)
                && last.kind == commit.kind
                && last.source == commit.source
                && last.message_id == commit.message_id
                && last.part_id == commit.part_id
                && last.tool == commit.tool
        });
        if joins {
            self.local.pop();
        }
        self.local.push(commit.clone());
        let excess = self.local.len().saturating_sub(LOCAL_ROW_LIMIT);
        self.local.drain(..excess);
    }

    /// Commits of a live event remembered as local rows: streamed text is remembered whole.
    fn remember_all(&mut self, commits: &[Commit]) {
        if self.initial || self.buffered.is_some() {
            return;
        }
        for commit in commits {
            let whole = match (&commit.message_id, &commit.part_id, commit.kind) {
                (Some(message), Some(part), EntryKind::Assistant | EntryKind::Reasoning) => self
                    .fragments
                    .value(&Fragment { message_id: message.clone(), part_id: part.clone() })
                    .map(|text| match commit.kind {
                        EntryKind::Reasoning if !text.is_empty() => format!("Thinking: {text}"),
                        _ => text.to_owned(),
                    }),
                _ => None,
            };
            let commit = match whole {
                Some(text) => Commit { text, ..commit.clone() },
                None => commit.clone(),
            };
            self.remember(&commit);
        }
    }

    /// A prompt this client admitted (`mergePending`). It prints once the server delivers it.
    /// Whether the server already delivered this inbox item (`promotedMessages`).
    pub fn promoted(&self, message_id: &str) -> bool {
        self.promoted.contains(message_id)
    }

    pub fn admitted(&mut self, message_id: &str, text: &str) -> Output {
        if self.promoted.contains(message_id) {
            return self.user(message_id, text, true);
        }
        self.pending.insert(message_id.to_owned(), Pending { text: text.to_owned() });
        Output::default()
    }

    fn user(&mut self, message_id: &str, text: &str, render: bool) -> Output {
        let visible = !self.message_ids.insert(message_id.to_owned());
        if !render || visible || text.trim().is_empty() {
            return Output::default();
        }
        let commit = Commit::new(EntryKind::User, Source::System, Phase::Start, text).message(message_id);
        Output::commits(vec![commit])
    }

    /// `rememberToolMessage`: a message that calls tools shows no text while tools are hidden.
    fn remember_tool_message(&mut self, message: &str) {
        self.tool_messages.insert(message.to_owned());
        self.quiet.retain(|(id, _)| id != message);
    }

    /// `bufferQuietText`.
    fn buffer_quiet(&mut self, message: &str, part: &str, text: &str, replace: bool) {
        if text.is_empty() || self.tool_messages.contains(message) {
            return;
        }
        let parts = match self.quiet.iter_mut().find(|(id, _)| id == message) {
            Some((_, parts)) => parts,
            None => {
                self.quiet.push((message.to_owned(), Vec::new()));
                &mut self.quiet.last_mut().expect("just pushed").1
            }
        };
        match parts.iter_mut().find(|(id, _)| id == part) {
            Some((_, current)) if replace => *current = text.to_owned(),
            Some((_, current)) => current.push_str(text),
            None => parts.push((part.to_owned(), text.to_owned())),
        }
    }

    /// `flushQuietText`: the buffered text of a message whose step ended.
    fn flush_quiet(&mut self, message: &str) -> Vec<Commit> {
        let Some(index) = self.quiet.iter().position(|(id, _)| id == message) else {
            return Vec::new();
        };
        let (_, parts) = self.quiet.remove(index);
        if self.tool_messages.contains(message) {
            return Vec::new();
        }
        parts
            .into_iter()
            .filter(|(_, text)| !text.is_empty())
            .map(|(part, text)| {
                Commit::new(EntryKind::Assistant, Source::Assistant, Phase::Progress, text)
                    .message(message)
                    .part_id(part)
            })
            .collect()
    }

    /// `renderMessage`: one message of a list.
    pub fn message(&mut self, message: &Value, render: bool) -> Output {
        let id = message["id"].as_str().unwrap_or_default();
        match message["type"].as_str() {
            Some("user") => {
                self.pending.remove(id);
                self.promoted.insert(id.to_owned());
                self.user(id, message["text"].as_str().unwrap_or_default(), render)
            }
            Some("compaction") => self.compaction(message, render),
            Some("assistant") => self.assistant(message, render),
            // Skills and shells are drawn by M.4.
            _ => Output::default(),
        }
    }

    fn compaction(&mut self, message: &Value, render: bool) -> Output {
        let id = message["id"].as_str().unwrap_or_default();
        if !self.message_ids.insert(id.to_owned()) {
            return Output::default();
        }
        let status = message["status"].as_str().unwrap_or_default();
        let header = || {
            let mut commit = Commit::new(EntryKind::System, Source::System, Phase::Start, "Compaction")
                .message(id)
                .part_id("compaction:header");
            commit.compaction = true;
            commit
        };
        if status == "failed" {
            if !render || message["error"]["type"] == "aborted" {
                return Output::default();
            }
            let error = Commit::error(message["error"]["message"].as_str().unwrap_or_default())
                .message(id)
                .part_id("compaction:error");
            return Output::commits(vec![header(), error]);
        }
        let summary = message["summary"].as_str().unwrap_or_default();
        let show = render || status == "running";
        let fragment = Fragment { message_id: id.to_owned(), part_id: "compaction:summary".into() };
        self.fragments.project(&fragment, summary, show);
        if !show {
            return Output::default();
        }
        let part = |text: &str, phase| {
            Commit::new(EntryKind::Assistant, Source::Assistant, phase, text).message(id).part_id("compaction:summary")
        };
        let mut commits = vec![header()];
        if !summary.is_empty() {
            commits.push(part(summary, Phase::Progress));
        }
        if status == "completed" {
            commits.push(part("", Phase::Final));
        }
        Output::commits(commits)
    }

    fn assistant(&mut self, message: &Value, render: bool) -> Output {
        let id = message["id"].as_str().unwrap_or_default();
        self.message_ids.insert(id.to_owned());
        let content = message["content"].as_array().map(Vec::as_slice).unwrap_or_default();
        let has_tools = content.iter().any(|item| item["type"] == "tool");
        if has_tools && !self.tools {
            self.remember_tool_message(id);
        }
        let mut commits = Vec::new();
        let (mut text_ordinal, mut reasoning_ordinal) = (0, 0);
        for item in content {
            let text = item["text"].as_str().unwrap_or_default();
            match item["type"].as_str() {
                Some("text") => {
                    let fragment = Fragment::new(id, "text", text_ordinal);
                    text_ordinal += 1;
                    let visible = render && (self.tools || !has_tools);
                    let update = self.fragments.project(&fragment, text, visible);
                    if visible && text.len() > update.previous.len() {
                        commits.push(text_commit(&fragment, suffix(text, &update.previous)));
                    }
                }
                Some("reasoning") => {
                    let fragment = Fragment::new(id, "reasoning", reasoning_ordinal);
                    reasoning_ordinal += 1;
                    let update = self.fragments.project(&fragment, text, render);
                    if render && self.thinking && text.len() > update.previous.len() {
                        let delta = if update.previous.is_empty() {
                            format!("Thinking: {text}")
                        } else {
                            suffix(text, &update.previous).to_owned()
                        };
                        commits.push(reasoning_commit(&fragment, delta));
                    }
                }
                Some("tool") if render && self.tools => {
                    commits.extend(crate::tools::commits(id, item));
                }
                _ => {}
            }
        }
        if let Some(error) = message.get("error").filter(|error| !error.is_null())
            && self.errors.insert(id.to_owned())
            && render
        {
            commits.push(Commit::error(error_message(error)).message(id));
        }
        Output::commits(commits)
    }

    /// `apply`: one live event of this session. Events of other sessions are ignored here (subagents are M.3's).
    pub fn event(&mut self, event: &Value) -> Output {
        if let Some(buffered) = &mut self.buffered {
            buffered.push(event.clone());
            return Output::default();
        }
        let data = &event["data"];
        let kind = event["type"].as_str().unwrap_or_default();
        let session = match kind {
            "form.created" => data["form"]["sessionID"].as_str(),
            _ => data["sessionID"].as_str(),
        };
        if session != Some(self.session_id.as_str()) {
            return Output::default();
        }
        let output = self.apply(kind, event, data);
        self.remember_all(&output.commits);
        output
    }

    fn apply(&mut self, kind: &str, event: &Value, data: &Value) -> Output {
        let message = data["assistantMessageID"].as_str().unwrap_or_default();
        let ordinal = data["ordinal"].as_u64().unwrap_or_default();
        match kind {
            "session.renamed" => Output { title: data["title"].as_str().map(str::to_owned), ..Output::default() },
            "session.inbox.enqueued" => {
                if data["item"]["type"] != "user" {
                    return Output::default();
                }
                let id = data["inboxID"].as_str().unwrap_or_default();
                let text = data["item"]["payload"]["text"].as_str().unwrap_or_default();
                let mut output = self.admitted(id, text);
                output.footer.push(event.clone());
                output
            }
            "session.inbox.delivered" => {
                let id = data["inboxID"].as_str().unwrap_or_default();
                self.promoted.insert(id.to_owned());
                let mut output = match self.pending.remove(id) {
                    Some(pending) => self.user(id, &pending.text, true),
                    None => Output::default(),
                };
                output.extend(Output::patch(true, "waiting for assistant"));
                output.footer.push(event.clone());
                output
            }
            "session.inbox.cancelled" => {
                self.pending.remove(data["inboxID"].as_str().unwrap_or_default());
                Output { footer: vec![event.clone()], ..Output::default() }
            }
            "session.step.started" => Output::patch(true, "assistant responding"),
            "session.text.delta" => {
                let fragment = Fragment::new(message, "text", ordinal);
                let delta = data["delta"].as_str().unwrap_or_default();
                if self.fragments.delta(&fragment, delta).is_none() {
                    return Output::default();
                }
                if !self.tools {
                    self.buffer_quiet(message, &fragment.part_id, delta, false);
                    return Output::default();
                }
                Output::commits(vec![text_commit(&fragment, delta)])
            }
            "session.text.ended" => {
                let fragment = Fragment::new(message, "text", ordinal);
                let text = data["text"].as_str().unwrap_or_default();
                let update = self.fragments.end(&fragment, text);
                if !self.tools {
                    self.buffer_quiet(message, &fragment.part_id, text, true);
                    return Output::default();
                }
                if text.len() <= update.previous.len() {
                    return Output::default();
                }
                Output::commits(vec![text_commit(&fragment, suffix(text, &update.previous))])
            }
            "session.reasoning.delta" => {
                let fragment = Fragment::new(message, "reasoning", ordinal);
                let delta = data["delta"].as_str().unwrap_or_default();
                match self.fragments.delta(&fragment, delta) {
                    Some(update) if self.thinking => {
                        let text =
                            if update.previous.is_empty() { format!("Thinking: {delta}") } else { delta.to_owned() };
                        Output::commits(vec![reasoning_commit(&fragment, text)])
                    }
                    _ => Output::default(),
                }
            }
            "session.reasoning.ended" => {
                let fragment = Fragment::new(message, "reasoning", ordinal);
                let text = data["text"].as_str().unwrap_or_default();
                let update = self.fragments.end(&fragment, text);
                if !self.thinking || text.len() <= update.previous.len() {
                    return Output::default();
                }
                let text = if update.previous.is_empty() {
                    format!("Thinking: {text}")
                } else {
                    suffix(text, &update.previous).to_owned()
                };
                Output::commits(vec![reasoning_commit(&fragment, text)])
            }
            "session.step.ended" => {
                let tokens = &data["tokens"];
                let count = |value: &Value| value.as_u64().unwrap_or_default();
                let total = count(&tokens["input"])
                    + count(&tokens["output"])
                    + count(&tokens["reasoning"])
                    + count(&tokens["cache"]["read"])
                    + count(&tokens["cache"]["write"]);
                let cost = data["cost"].as_f64().filter(|cost| *cost != 0.0);
                let quiet = self.flush_quiet(message);
                Output {
                    commits: quiet,
                    patch: Some(Patch {
                        usage: Some((total > 0 || cost.is_some()).then_some(Usage {
                            tokens: total,
                            percent: None,
                            cost,
                        })),
                        ..Patch::default()
                    }),
                    ..Output::default()
                }
            }
            "session.step.failed" => {
                let mut commits = self.flush_quiet(message);
                if self.errors.insert(message.to_owned()) {
                    commits.push(Commit::error(error_message(&data["error"])).message(message));
                }
                Output::commits(commits)
            }
            "session.execution.started" => {
                self.root_active = true;
                Output { patch: Some(Patch { running: Some(true), ..Patch::default() }), ..Output::default() }
            }
            "session.execution.succeeded" | "session.execution.failed" | "session.execution.interrupted" => {
                self.root_active = false;
                let messages: Vec<String> = self.quiet.iter().map(|(id, _)| id.clone()).collect();
                let commits = messages.iter().flat_map(|id| self.flush_quiet(id)).collect();
                Output { commits, ..Output::patch(false, "") }
            }
            kind if kind.starts_with("session.tool.") && !self.tools => {
                self.remember_tool_message(message);
                Output { footer: vec![event.clone()], ..Output::default() }
            }
            kind if kind.starts_with("session.tool.")
                || kind.starts_with("session.shell.")
                || kind.starts_with("session.compaction.")
                || kind.starts_with("permission.")
                || kind.starts_with("form.") =>
            {
                Output { footer: vec![event.clone()], ..Output::default() }
            }
            _ => Output::default(),
        }
    }
}

/// `text.slice(previous.length)`, by byte, on a character boundary.
fn suffix<'a>(text: &'a str, previous: &str) -> &'a str {
    text.get(previous.len()..).unwrap_or_default()
}

fn text_commit(fragment: &Fragment, text: impl Into<String>) -> Commit {
    Commit::new(EntryKind::Assistant, Source::Assistant, Phase::Progress, text)
        .message(&fragment.message_id)
        .part_id(&fragment.part_id)
}

fn reasoning_commit(fragment: &Fragment, text: impl Into<String>) -> Commit {
    Commit::new(EntryKind::Reasoning, Source::Reasoning, Phase::Progress, text)
        .message(&fragment.message_id)
        .part_id(&fragment.part_id)
}

/// `errorMessage`: the message, else the tag.
fn error_message(error: &Value) -> String {
    [&error["message"], &error["_tag"]]
        .into_iter()
        .filter_map(Value::as_str)
        .find(|text| !text.is_empty())
        .unwrap_or("Session execution failed")
        .to_owned()
}

/// What the network side posts to the UI thread.
pub enum Incoming {
    /// The stream (re)connected and the messages were listed.
    Hydrated {
        messages: Vec<Value>,
        active: bool,
    },
    Event(Value),
    /// The stream dropped; it reconnects.
    Disconnected(String),
}

/// `projectedMessages`: the newest `limit` messages, oldest first.
pub async fn messages(client: &Client, session: &str, limit: u32) -> Result<Vec<Value>, String> {
    let input = MessageListInput {
        session_id: SessionID(session.to_owned()),
        limit: Some(i64::from(limit)),
        order: Some(MessageListInputOrder::Desc),
        ..Default::default()
    };
    let call = Client::message_list_call(&input).map_err(|error| error.to_string())?;
    let list: Value = client.json(call).await.map_err(|error| error.to_string())?;
    let mut data = list["data"].as_array().cloned().unwrap_or_default();
    data.reverse();
    Ok(data)
}

/// Whether the session is running (`session.active`).
pub async fn active(client: &Client, session: &str) -> bool {
    let Ok(call) = Client::session_active_call() else { return false };
    client.json::<Value>(call).await.is_ok_and(|active| active["data"].get(session).is_some())
}

/// Lists the messages and whether the session runs, as a hydration does.
pub async fn hydration(client: &Client, session: &str, limit: u32) -> Result<(Vec<Value>, bool), String> {
    let messages = messages(client, session, limit).await?;
    Ok((messages, active(client, session).await))
}

/// `connect`: subscribes, hydrates after `server.connected`, then forwards events, reconnecting after 250 ms
/// when the stream drops. Runs until `proxy` closes.
pub async fn connect(client: Client, session: String, limit: u32, proxy: AppProxy) {
    loop {
        let error = match stream(&client, &session, limit, &proxy).await {
            Ok(()) => return,
            Err(error) => error,
        };
        if !post(&proxy, Incoming::Disconnected(error)).await {
            return;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

/// One connection. `Ok` means the app is gone.
async fn stream(client: &Client, session: &str, limit: u32, proxy: &AppProxy) -> Result<(), String> {
    let response = client.event_subscribe(&EventSubscribeInput::default()).await.map_err(|error| error.to_string())?;
    let mut events = Box::pin(SseResponse::<Value>::new(response.response).events(|| {}));
    match events.next().await {
        Some(Ok(first)) if first["type"] == "server.connected" => {}
        _ => return Err("Event stream disconnected".into()),
    }
    // Events that arrive meanwhile wait in the stream, so they reach the UI after the hydration.
    let (messages, active) = hydration(client, session, limit).await?;
    if !post(proxy, Incoming::Hydrated { messages, active }).await {
        return Ok(());
    }
    while let Some(event) = events.next().await {
        let event = event.map_err(|error| error.to_string())?;
        if !post(proxy, Incoming::Event(event)).await {
            return Ok(());
        }
    }
    Err("Event stream disconnected".into())
}

/// An [`Incoming`] on its way to the UI thread. A full queue drops the envelope but not the message, which the
/// sender still holds and posts again.
#[derive(Clone)]
pub struct Envelope(Arc<Mutex<Option<Incoming>>>);

impl Envelope {
    pub fn take(&self) -> Option<Incoming> {
        self.0.lock().ok()?.take()
    }
}

/// Posts to the UI thread, waiting while its queue is full. False once the app has ended.
pub async fn post(proxy: &AppProxy, incoming: Incoming) -> bool {
    let envelope = Envelope(Arc::new(Mutex::new(Some(incoming))));
    loop {
        match proxy.send(envelope.clone()) {
            Ok(()) => return true,
            Err(ProxyError::Full) => tokio::time::sleep(Duration::from_millis(5)).await,
            Err(_) => return false,
        }
    }
}

/// `model.default` at `directory`: the model a session without one uses, as `(providerID, id)`.
pub async fn default_model(client: &Client, directory: &str) -> Option<(String, String)> {
    let input = ModelDefaultInput { location: Some(LocationQueryInput { directory: Some(directory.to_owned()) }) };
    let value: Value = client.json(Client::model_default_call(&input).ok()?).await.ok()?;
    let data = &value["data"];
    Some((data["providerID"].as_str()?.to_owned(), data["id"].as_str()?.to_owned()))
}

/// `experimental.session.wait`: returns once the session is idle.
pub async fn wait(client: &Client, session: &str) -> Result<(), String> {
    let input = ExperimentalSessionWaitInput { session_id: SessionID(session.to_owned()) };
    client.experimental_session_wait(&input).await.map_err(|error| error.to_string())
}

/// `session.interrupt`, for mini's two-press gesture (`resume: true`) and run's shutdown.
pub async fn interrupt(client: &Client, session: &str, resume: Option<bool>) -> Result<(), String> {
    let input = SessionInterruptInput { session_id: SessionID(session.to_owned()), resume };
    client.session_interrupt(&input).await.map(drop).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The two-press interrupt sends `resume` as a query value, as `session.interrupt` declares, and takes the
    /// server's 200 as success.
    #[tokio::test]
    async fn interrupt_resumes_through_the_query() {
        use opencode_api::memory::{Memory, Route};
        let memory = Memory::new(vec![Route::json(
            "POST",
            "/api/session/ses_1/interrupt",
            200,
            &json!({ "interrupted": true }),
        )]);
        let client = Client::with_transport("http://test", Arc::new(memory.clone())).unwrap();
        assert_eq!(interrupt(&client, "ses_1", Some(true)).await, Ok(()));
        let sent = memory.requests();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].path, "/api/session/ses_1/interrupt");
        assert_eq!(sent[0].query, [("resume".to_owned(), vec!["true".to_owned()])].into());
        assert_eq!(sent[0].body, None);
    }

    fn texts(output: &Output) -> Vec<(EntryKind, String)> {
        output.commits.iter().map(|commit| (commit.kind, commit.text.clone())).collect()
    }

    fn history() -> Vec<Value> {
        vec![
            json!({ "id": "msg_u1", "type": "user", "text": "first" }),
            json!({ "id": "msg_a1", "type": "assistant", "content": [
                { "type": "reasoning", "text": "hmm" },
                { "type": "text", "text": "answer" },
            ] }),
            json!({ "id": "msg_a2", "type": "assistant", "content": [], "error": { "_tag": "Boom" } }),
        ]
    }

    #[test]
    fn hydration_renders_history_only_with_replay() {
        let mut quiet = Transcript::new("ses_1", true, true, false, None);
        assert!(quiet.hydrate(&history(), false).commits.is_empty());
        let mut shown = Transcript::new("ses_1", true, true, true, None);
        assert_eq!(
            texts(&shown.hydrate(&history(), false)),
            [
                (EntryKind::User, "first".into()),
                (EntryKind::Reasoning, "Thinking: hmm".into()),
                (EntryKind::Assistant, "answer".into()),
                (EntryKind::Error, "Boom".into()),
            ]
        );
        // A later list prints nothing twice.
        assert!(shown.hydrate(&history(), false).commits.is_empty());
        let mut hidden = Transcript::new("ses_1", false, true, true, None);
        assert_eq!(hidden.hydrate(&history(), false).commits.len(), 3);
    }

    #[test]
    fn live_deltas_after_a_list_print_only_what_is_new() {
        let mut transcript = Transcript::new("ses_1", true, true, true, None);
        transcript.hydrate(
            &[json!({ "id": "msg_a", "type": "assistant", "content": [{ "type": "text", "text": "Hello" }] })],
            true,
        );
        let delta = |text: &str| {
            json!({ "type": "session.text.delta", "data": {
            "sessionID": "ses_1", "assistantMessageID": "msg_a", "ordinal": 0, "delta": text } })
        };
        assert!(transcript.event(&delta("Hel")).commits.is_empty());
        assert!(transcript.event(&delta("lo")).commits.is_empty());
        assert_eq!(texts(&transcript.event(&delta(" world"))), [(EntryKind::Assistant, " world".into())]);
        let ended = json!({ "type": "session.text.ended", "data": {
            "sessionID": "ses_1", "assistantMessageID": "msg_a", "ordinal": 0, "text": "Hello world!" } });
        assert_eq!(texts(&transcript.event(&ended)), [(EntryKind::Assistant, "!".into())]);
        let other = json!({ "type": "session.text.delta", "data": {
            "sessionID": "ses_2", "assistantMessageID": "msg_b", "ordinal": 0, "delta": "x" } });
        assert!(transcript.event(&other).commits.is_empty());
    }

    #[test]
    fn with_tools_hidden_text_waits_for_its_step_and_tool_messages_stay_quiet() {
        let mut transcript = Transcript::new("ses_1", true, false, true, None);
        transcript.hydrate(&[], true);
        let event = |kind: &str, data: Value| {
            let mut data = data;
            data["sessionID"] = json!("ses_1");
            json!({ "type": kind, "data": data })
        };
        let delta = |message: &str, text: &str| {
            event("session.text.delta", json!({ "assistantMessageID": message, "ordinal": 0, "delta": text }))
        };
        assert!(transcript.event(&delta("msg_a", "Hello")).commits.is_empty());
        assert!(transcript.event(&delta("msg_a", " there")).commits.is_empty());
        let ended = event("session.step.ended", json!({ "assistantMessageID": "msg_a", "tokens": {} }));
        assert_eq!(texts(&transcript.event(&ended)), [(EntryKind::Assistant, "Hello there".into())]);
        assert!(transcript.event(&delta("msg_b", "Let me look")).commits.is_empty());
        let tool = event("session.tool.called", json!({ "assistantMessageID": "msg_b", "id": "call_1" }));
        assert!(transcript.event(&tool).commits.is_empty());
        let done = event("session.execution.succeeded", json!({}));
        assert!(transcript.event(&done).commits.is_empty());
    }

    #[test]
    fn an_admitted_prompt_prints_when_delivered() {
        let mut transcript = Transcript::new("ses_1", true, true, true, None);
        transcript.hydrate(&[], false);
        assert!(transcript.admitted("msg_p", "hi").commits.is_empty());
        let delivered =
            json!({ "type": "session.inbox.delivered", "data": { "sessionID": "ses_1", "inboxID": "msg_p" } });
        let output = transcript.event(&delivered);
        assert_eq!(texts(&output), [(EntryKind::User, "hi".into())]);
        assert_eq!(output.patch.unwrap().status.as_deref(), Some("waiting for assistant"));
        // The listed user message does not print it again.
        let listed = json!({ "id": "msg_p", "type": "user", "text": "hi" });
        assert!(transcript.message(&listed, true).commits.is_empty());
    }

    #[test]
    fn a_resize_replay_lists_again_then_restores_local_rows_and_waiting_events() {
        let mut transcript = Transcript::new("ses_1", true, true, true, None);
        transcript.hydrate(&history(), false);
        // A live answer the list does not have yet, and a local error.
        let delta = json!({ "type": "session.text.delta", "data": {
            "sessionID": "ses_1", "assistantMessageID": "msg_live", "ordinal": 0, "delta": "streamed" } });
        transcript.event(&delta);
        transcript.remember(&Commit::error("send failed").message("msg_local"));
        transcript.begin_replay();
        let late = json!({ "type": "session.text.delta", "data": {
            "sessionID": "ses_1", "assistantMessageID": "msg_live", "ordinal": 0, "delta": " more" } });
        assert!(transcript.event(&late).commits.is_empty());
        let output = transcript.replayed(&history(), false);
        assert_eq!(
            texts(&output),
            [
                (EntryKind::User, "first".into()),
                (EntryKind::Reasoning, "Thinking: hmm".into()),
                (EntryKind::Assistant, "answer".into()),
                (EntryKind::Error, "Boom".into()),
                (EntryKind::Assistant, "streamed".into()),
                (EntryKind::Error, "send failed".into()),
                (EntryKind::Assistant, " more".into()),
            ]
        );
        assert!(!transcript.replaying());
    }

    #[test]
    fn fragments_match_the_reconciler() {
        let mut fragments = Fragments::default();
        let part = Fragment::new("msg", "text", 0);
        assert_eq!(fragments.project(&part, "abc", true).previous, "");
        assert_eq!(fragments.delta(&part, "b"), None);
        assert_eq!(fragments.delta(&part, "c"), None);
        assert_eq!(fragments.delta(&part, "d").unwrap().previous, "abc");
        assert_eq!(fragments.restore(&part, "ab"), Restore::Covered);
        assert_eq!(fragments.restore(&part, "abcdef"), Restore::Append("ef".into()));
        assert_eq!(fragments.restore(&part, "xyz"), Restore::Conflict);
        assert_eq!(fragments.end(&part, "final").previous, "abcdef");
    }
}
