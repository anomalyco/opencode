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
use opencode_api::error::Error;
use opencode_api::generated::{
    ExperimentalSessionWaitInput, LocationQueryInput, MessageListInput, MessageListInputOrder, ModelDefaultInput,
    SessionID, SessionInboxItem, SessionInterruptInput, SessionMessageAssistant,
    SessionMessageAssistantContentItem as ContentItem, SessionMessageAssistantTool, SessionMessageAssistantToolState,
    SessionMessageAssistantToolState as ToolPartState, SessionMessageAssistantToolTime, SessionMessageCompaction,
    SessionMessageInfo, SessionMessageShellExit, SessionMessageShellOutput, SessionMessageToolStateCompleted,
    SessionMessageToolStateError, SessionMessageToolStateRunning, SessionMessageToolStateStreaming,
    SessionStructuredError, V2Event,
};
use opentui::app::ProxyError;
use opentui::prelude::*;
use serde::Deserialize;
use serde_json::Value;

use crate::scrollback::{Commit, EntryKind, Phase, Source, ToolState};

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
    pub footer: Vec<V2Event>,
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
    buffered: Option<Vec<V2Event>>,
    /// Rows printed only locally, newest last (`localRows`).
    local: Vec<Commit>,
    /// With tools hidden, a message's text waits for its step to end, and is dropped when the message turns out
    /// to call tools (`quietText`, `toolMessages`).
    quiet: Vec<(String, Vec<(String, String)>)>,
    tool_messages: HashSet<String>,
    /// The session's directory, which tool paths are shown relative to.
    pub directory: Option<String>,
    /// Tool parts still running, by message and call (`tools`).
    tool_tracks: HashMap<String, ToolTrack>,
    finished_tools: HashSet<String>,
    image_ids: HashSet<String>,
    skill_messages: HashSet<String>,
    shell_commands: HashMap<String, String>,
    shell_started: HashSet<String>,
    shell_ended: HashSet<String>,
    active_compaction: Option<String>,
}

/// A tool part that is still running (`ToolState`): the output already shown, and the snapshot version it shows
/// it under when the output was replaced rather than extended.
#[derive(Clone, Debug)]
struct ToolTrack {
    part: SessionMessageAssistantTool,
    output: String,
    version: u32,
    started: bool,
}

fn part_key(message: &str, id: &str) -> String {
    format!("{message}\u{0}{id}")
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
            directory: None,
            tool_tracks: HashMap::new(),
            finished_tools: HashSet::new(),
            image_ids: HashSet::new(),
            skill_messages: HashSet::new(),
            shell_commands: HashMap::new(),
            shell_started: HashSet::new(),
            shell_ended: HashSet::new(),
            active_compaction: None,
        }
    }

    /// The first or a reconnecting hydration (`hydrate`): every listed message, shown unless this is the first
    /// hydration and replay is off.
    pub fn hydrate(&mut self, messages: &[SessionMessageInfo], active: bool) -> Output {
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
    pub fn replayed(&mut self, messages: &[SessionMessageInfo], active: bool) -> Output {
        let buffered = self.buffered.take().unwrap_or_default();
        self.message_ids.clear();
        self.errors.clear();
        self.fragments.clear();
        self.tool_tracks.clear();
        self.finished_tools.clear();
        self.tool_messages.clear();
        self.image_ids.clear();
        self.skill_messages.clear();
        self.shell_started.clear();
        self.shell_ended.clear();
        self.shell_commands.clear();
        self.quiet.clear();
        self.active_compaction = None;
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

    /// `renderTool`: one state of a tool part, from a list or rebuilt from live events. A running part prints its
    /// start once and then only output it did not print yet; output that was replaced rather than extended starts a
    /// new snapshot. A finished part prints its end once.
    fn render_tool(&mut self, message: &str, part: &SessionMessageAssistantTool, render: bool) -> Output {
        let render = render && self.tools;
        if !self.tools {
            self.remember_tool_message(message);
        }
        let key = part_key(message, &part.id);
        if self.finished_tools.contains(&key) {
            return Output::default();
        }
        if matches!(part.state, ToolPartState::Streaming(_)) {
            self.tool_tracks
                .insert(key, ToolTrack { part: part.clone(), output: String::new(), version: 0, started: false });
            return Output::default();
        }
        let name = opencode_ui::tool_info::canonical_tool_name(&part.name).to_owned();
        let directory = self.directory.clone();
        let directory = directory.as_deref();
        let current = self.tool_tracks.get(&key).cloned();
        let output =
            opencode_ui::tool_info::tool_output_text(&name, &opencode_ui::tool_info::tool_display_content(&part.state));
        let prefix = current.as_ref().is_some_and(|current| output.starts_with(&current.output));
        let version = match &current {
            Some(current) if !prefix => current.version + 1,
            Some(current) => current.version,
            None => 0,
        };
        let delta = match &current {
            Some(current) if prefix => output[current.output.len()..].to_owned(),
            _ => output.clone(),
        };
        let started = current.as_ref().is_some_and(|current| current.started);
        let mut result = Output::default();
        if let ToolPartState::Running(state) = &part.state {
            let ready = name != "websearch" || state.metadata.get("provider").is_some_and(Value::is_string);
            if render && !started && ready {
                result.commits.push(crate::tools::commit(part, message, Phase::Start, None, directory, version));
                result.extend(Output::patch(true, &format!("running {name}")));
            }
            if render && !delta.is_empty() {
                result.commits.push(crate::tools::commit(
                    part,
                    message,
                    Phase::Progress,
                    Some(&delta),
                    directory,
                    version,
                ));
            }
            self.tool_tracks
                .insert(key, ToolTrack { part: part.clone(), output, version, started: started || (render && ready) });
            return result;
        }
        if render && !started {
            result.commits.push(crate::tools::commit(part, message, Phase::Start, None, directory, version));
        }
        self.finished_tools.insert(key);
        self.tool_tracks.remove(&part_key(message, &part.id));
        let images: Vec<Commit> = crate::tools::image_commits(part, message)
            .into_iter()
            .filter(|commit| {
                let id = part_key(message, commit.part_id.as_deref().unwrap_or_default());
                self.image_ids.insert(id) && render
            })
            .collect();
        if !render {
            return result;
        }
        let phase = crate::tools::final_phase(part);
        if matches!(part.state, ToolPartState::Error(_)) && !delta.is_empty() {
            result.commits.push(crate::tools::commit(part, message, Phase::Progress, Some(&delta), directory, version));
        }
        let value = (phase == Phase::Progress).then_some(delta.as_str());
        result.commits.push(crate::tools::commit(part, message, phase, value, directory, version));
        result.commits.extend(images);
        result
    }

    /// `renderMessage`: one message of a list.
    pub fn message(&mut self, message: &SessionMessageInfo, render: bool) -> Output {
        match message {
            SessionMessageInfo::User(user) => {
                let id = user.id.as_str();
                self.pending.remove(id);
                self.promoted.insert(id.to_owned());
                self.user(id, &user.text, render)
            }
            SessionMessageInfo::Compaction(compaction) => self.compaction(compaction, render),
            SessionMessageInfo::Assistant(assistant) => self.assistant(assistant, render),
            SessionMessageInfo::Skill(skill) => {
                let id = skill.id.as_str();
                let fresh = self.skill_messages.insert(id.to_owned());
                if !render || !self.tools || !fresh {
                    return Output::default();
                }
                Output::commits(vec![skill_commit(id, skill.name.as_str())])
            }
            SessionMessageInfo::Shell(shell) => {
                let id = shell.shell_id.as_str();
                self.shell_commands.insert(id.to_owned(), shell.command.clone());
                let completed = shell.time.completed.is_some();
                if !render {
                    // Settled shells of a quiet history stay silent when they arrive again live.
                    if completed {
                        self.shell_started.insert(id.to_owned());
                        self.shell_ended.insert(id.to_owned());
                    }
                    return Output::default();
                }
                let mut commits = Vec::new();
                if self.shell_started.insert(id.to_owned()) {
                    commits.push(shell_commit(id, &shell.command, "running shell", Phase::Start, ToolState::Running));
                }
                if completed
                    && let Some(output) = &shell.output
                    && self.shell_ended.insert(id.to_owned())
                {
                    let exit = match &shell.exit {
                        Some(SessionMessageShellExit::Number(code)) => Some(opencode_api::js::number_to_string(*code)),
                        Some(SessionMessageShellExit::String(code)) => Some(code.clone()),
                        _ => None,
                    };
                    commits.extend(shell_terminal(id, &shell.command, shell.status.as_str(), exit, output));
                }
                Output::commits(commits)
            }
            _ => Output::default(),
        }
    }

    fn compaction(&mut self, message: &SessionMessageCompaction, render: bool) -> Output {
        let (id, summary, completed) = match message {
            SessionMessageCompaction::Running(running) => (running.id.as_str(), running.summary.as_str(), false),
            SessionMessageCompaction::Completed(done) => (done.id.as_str(), done.summary.as_str(), true),
            SessionMessageCompaction::Failed(failed) => (failed.id.as_str(), "", false),
            SessionMessageCompaction::Unknown(_) => return Output::default(),
        };
        if !self.message_ids.insert(id.to_owned()) {
            return Output::default();
        }
        let header = || {
            let mut commit = Commit::new(EntryKind::System, Source::System, Phase::Start, "Compaction")
                .message(id)
                .part_id("compaction:header");
            commit.compaction = true;
            commit
        };
        if let SessionMessageCompaction::Failed(failed) = message {
            if !render || failed.error.r#type == "aborted" {
                return Output::default();
            }
            let error = Commit::error(&failed.error.message).message(id).part_id("compaction:error");
            return Output::commits(vec![header(), error]);
        }
        let show = render || matches!(message, SessionMessageCompaction::Running(_));
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
        if completed {
            commits.push(part("", Phase::Final));
        }
        Output::commits(commits)
    }

    fn assistant(&mut self, message: &SessionMessageAssistant, render: bool) -> Output {
        let id = message.id.as_str();
        self.message_ids.insert(id.to_owned());
        let has_tools = message.content.iter().any(|item| matches!(item, ContentItem::Tool(_)));
        if has_tools && !self.tools {
            self.remember_tool_message(id);
        }
        let mut commits = Vec::new();
        let (mut text_ordinal, mut reasoning_ordinal) = (0, 0);
        for item in &message.content {
            match item {
                ContentItem::Text(part) => {
                    let text = part.text.as_str();
                    let fragment = Fragment::new(id, "text", text_ordinal);
                    text_ordinal += 1;
                    let visible = render && (self.tools || !has_tools);
                    let update = self.fragments.project(&fragment, text, visible);
                    if visible && text.len() > update.previous.len() {
                        commits.push(text_commit(&fragment, suffix(text, &update.previous)));
                    }
                }
                ContentItem::Reasoning(part) => {
                    let text = part.text.as_str();
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
                ContentItem::Tool(tool) => commits.extend(self.render_tool(id, tool, render).commits),
                _ => {}
            }
        }
        if let Some(error) = &message.error
            && self.errors.insert(id.to_owned())
            && render
        {
            commits.push(Commit::error(error_message(error)).message(id));
        }
        Output::commits(commits)
    }

    /// `apply`: one live event of this session. Events of other sessions are ignored here (subagents are M.3's).
    pub fn event(&mut self, event: &V2Event) -> Output {
        if let Some(buffered) = &mut self.buffered {
            buffered.push(event.clone());
            return Output::default();
        }
        if session_of(event) != Some(self.session_id.as_str()) {
            return Output::default();
        }
        let output = self.apply(event);
        self.remember_all(&output.commits);
        output
    }

    fn apply(&mut self, event: &V2Event) -> Output {
        let footer = || Output { footer: vec![event.clone()], ..Output::default() };
        match event {
            V2Event::SessionRenamed(renamed) => Output { title: Some(renamed.data.title.clone()), ..Output::default() },
            V2Event::SessionInboxEnqueued(enqueued) => {
                let SessionInboxItem::User(item) = &enqueued.data.item else {
                    return Output::default();
                };
                let mut output = self.admitted(enqueued.data.inbox_id.as_str(), &item.payload.text);
                output.footer.push(event.clone());
                output
            }
            V2Event::SessionInboxDelivered(delivered) => {
                let id = delivered.data.inbox_id.as_str();
                self.promoted.insert(id.to_owned());
                let mut output = match self.pending.remove(id) {
                    Some(pending) => self.user(id, &pending.text, true),
                    None => Output::default(),
                };
                output.extend(Output::patch(true, "waiting for assistant"));
                output.footer.push(event.clone());
                output
            }
            V2Event::SessionInboxCancelled(cancelled) => {
                self.pending.remove(cancelled.data.inbox_id.as_str());
                footer()
            }
            V2Event::SessionStepStarted(_) => Output::patch(true, "assistant responding"),
            V2Event::SessionTextDelta(delta) => {
                let data = &delta.data;
                let message = data.assistant_message_id.as_str();
                let fragment = Fragment::new(message, "text", data.ordinal as u64);
                if self.fragments.delta(&fragment, &data.delta).is_none() {
                    return Output::default();
                }
                if !self.tools {
                    self.buffer_quiet(message, &fragment.part_id, &data.delta, false);
                    return Output::default();
                }
                Output::commits(vec![text_commit(&fragment, data.delta.as_str())])
            }
            V2Event::SessionTextEnded(ended) => {
                let data = &ended.data;
                let message = data.assistant_message_id.as_str();
                let fragment = Fragment::new(message, "text", data.ordinal as u64);
                let update = self.fragments.end(&fragment, &data.text);
                if !self.tools {
                    self.buffer_quiet(message, &fragment.part_id, &data.text, true);
                    return Output::default();
                }
                if data.text.len() <= update.previous.len() {
                    return Output::default();
                }
                Output::commits(vec![text_commit(&fragment, suffix(&data.text, &update.previous))])
            }
            V2Event::SessionReasoningDelta(delta) => {
                let data = &delta.data;
                let fragment = Fragment::new(data.assistant_message_id.as_str(), "reasoning", data.ordinal as u64);
                match self.fragments.delta(&fragment, &data.delta) {
                    Some(update) if self.thinking => {
                        let text = if update.previous.is_empty() {
                            format!("Thinking: {}", data.delta)
                        } else {
                            data.delta.clone()
                        };
                        Output::commits(vec![reasoning_commit(&fragment, text)])
                    }
                    _ => Output::default(),
                }
            }
            V2Event::SessionReasoningEnded(ended) => {
                let data = &ended.data;
                let text = data.text.as_str();
                let fragment = Fragment::new(data.assistant_message_id.as_str(), "reasoning", data.ordinal as u64);
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
            V2Event::SessionStepEnded(ended) => {
                let data = &ended.data;
                let tokens = &data.tokens;
                let total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
                let cost = Some(data.cost).filter(|cost| *cost != 0.0);
                let quiet = self.flush_quiet(data.assistant_message_id.as_str());
                Output {
                    commits: quiet,
                    patch: Some(Patch {
                        usage: Some((total > 0.0 || cost.is_some()).then_some(Usage {
                            tokens: total as u64,
                            percent: None,
                            cost,
                        })),
                        ..Patch::default()
                    }),
                    ..Output::default()
                }
            }
            V2Event::SessionStepFailed(failed) => {
                let message = failed.data.assistant_message_id.as_str();
                let mut commits = self.flush_quiet(message);
                if self.errors.insert(message.to_owned()) {
                    commits.push(Commit::error(error_message(&failed.data.error)).message(message));
                }
                Output::commits(commits)
            }
            V2Event::SessionExecutionStarted(_) => {
                self.root_active = true;
                Output { patch: Some(Patch { running: Some(true), ..Patch::default() }), ..Output::default() }
            }
            V2Event::SessionExecutionSucceeded(_)
            | V2Event::SessionExecutionFailed(_)
            | V2Event::SessionExecutionInterrupted(_) => {
                self.root_active = false;
                let messages: Vec<String> = self.quiet.iter().map(|(id, _)| id.clone()).collect();
                let commits = messages.iter().flat_map(|id| self.flush_quiet(id)).collect();
                Output { commits, ..Output::patch(false, "") }
            }
            V2Event::SessionSkillActivated(activated) => {
                let message = message_from_event(activated.id.as_str());
                if !self.skill_messages.insert(message.clone()) || !self.tools {
                    return Output::default();
                }
                Output::commits(vec![skill_commit(&message, activated.data.name.as_str())])
            }
            V2Event::SessionShellStarted(started) => {
                let shell = &started.data.shell;
                let id = shell.id.as_str();
                self.shell_commands.insert(id.to_owned(), shell.command.clone());
                let mut output = footer();
                if self.shell_started.insert(id.to_owned()) {
                    output.commits.push(shell_commit(
                        id,
                        &shell.command,
                        "running shell",
                        Phase::Start,
                        ToolState::Running,
                    ));
                    output.extend(Output::patch(true, "running shell"));
                }
                output
            }
            V2Event::SessionShellEnded(ended) => {
                let shell = &ended.data.shell;
                let id = shell.id.as_str();
                let command = self.shell_commands.get(id).cloned().unwrap_or_else(|| shell.command.clone());
                let mut output = footer();
                if self.shell_started.insert(id.to_owned()) && !command.is_empty() {
                    output.commits.push(shell_commit(id, &command, "running shell", Phase::Start, ToolState::Running));
                }
                if self.shell_ended.insert(id.to_owned()) {
                    let exit = shell.exit.map(opencode_api::js::number_to_string);
                    output.commits.extend(shell_terminal(
                        id,
                        &command,
                        shell.status.as_str(),
                        exit,
                        &ended.data.output,
                    ));
                }
                output
            }
            V2Event::SessionCompactionStarted(started) => {
                let message = match &started.data.input_id {
                    Some(id) => id.as_str().to_owned(),
                    None => message_from_event(started.id.as_str()),
                };
                self.active_compaction = Some(message.clone());
                let mut output = footer();
                if self.message_ids.insert(message.clone()) {
                    output.commits.push(compaction_header(&message));
                    output.extend(Output::patch(true, "compacting session"));
                }
                output
            }
            V2Event::SessionCompactionDelta(delta) => {
                let mut output = footer();
                let Some(message) = self.active_compaction.clone() else { return output };
                let fragment = Fragment { message_id: message.clone(), part_id: "compaction:summary".into() };
                if self.fragments.delta(&fragment, &delta.data.text).is_some() {
                    output.commits.push(compaction_summary(&message, &delta.data.text, Phase::Progress));
                }
                output
            }
            V2Event::SessionCompactionEnded(ended) => {
                let mut output = footer();
                let Some(message) = self.active_compaction.take() else { return output };
                let fragment = Fragment { message_id: message.clone(), part_id: "compaction:summary".into() };
                let text = &ended.data.text;
                let update = self.fragments.end(&fragment, text);
                if text.len() > update.previous.len() {
                    output.commits.push(compaction_summary(&message, suffix(text, &update.previous), Phase::Progress));
                }
                output.commits.push(compaction_summary(&message, "", Phase::Final));
                output
            }
            V2Event::SessionCompactionFailed(failed) => {
                let mut output = footer();
                let Some(message) = self.active_compaction.take() else { return output };
                output.commits.push(compaction_summary(&message, "", Phase::Final));
                if failed.data.error.r#type != "aborted" {
                    output
                        .commits
                        .push(Commit::error(&failed.data.error.message).message(&message).part_id("compaction:error"));
                }
                output
            }
            V2Event::PermissionAsked(_)
            | V2Event::PermissionReplied(_)
            | V2Event::FormCreated(_)
            | V2Event::FormReplied(_)
            | V2Event::FormCancelled(_) => footer(),
            _ => self.tool_event(event).unwrap_or_default(),
        }
    }

    /// A `session.tool.*` event, rebuilt into the tool part it updates and rendered as a listed part would be.
    fn tool_event(&mut self, event: &V2Event) -> Option<Output> {
        let message = tool_message(event)?.to_owned();
        if !self.tools {
            self.remember_tool_message(&message);
            return Some(Output { footer: vec![event.clone()], ..Output::default() });
        }
        let current = |id: &str| self.tool_tracks.get(&part_key(&message, id)).map(|track| track.part.clone());
        let input_of = |part: &Option<SessionMessageAssistantTool>| match part.as_ref().map(|part| &part.state) {
            Some(ToolPartState::Running(state)) => state.input.clone(),
            Some(ToolPartState::Completed(state)) => state.input.clone(),
            Some(ToolPartState::Error(state)) => state.input.clone(),
            _ => Default::default(),
        };
        let tool =
            |id: &str, name: String, state: SessionMessageAssistantToolState, time| SessionMessageAssistantTool {
                r#type: "tool".into(),
                id: id.to_owned(),
                name,
                executed: None,
                native: None,
                state,
                time,
            };
        let time = |created: f64, ran: Option<f64>, completed: Option<f64>| SessionMessageAssistantToolTime {
            created,
            ran,
            completed,
        };
        let part = match event {
            V2Event::SessionToolInputStarted(started) => {
                let data = &started.data;
                let state = ToolPartState::Streaming(SessionMessageToolStateStreaming {
                    status: "streaming".into(),
                    input: String::new(),
                });
                tool(&data.id, data.name.clone(), state, time(started.created, None, None))
            }
            V2Event::SessionToolInputDelta(_) | V2Event::SessionToolInputEnded(_) => {
                let (id, text) = match event {
                    V2Event::SessionToolInputDelta(delta) => (&delta.data.id, Err(delta.data.delta.as_str())),
                    V2Event::SessionToolInputEnded(ended) => (&ended.data.id, Ok(ended.data.text.as_str())),
                    _ => return None,
                };
                let mut part = current(id)?;
                let ToolPartState::Streaming(state) = &mut part.state else { return Some(Output::default()) };
                match text {
                    Ok(text) => state.input = text.to_owned(),
                    Err(delta) => state.input.push_str(delta),
                }
                part
            }
            V2Event::SessionToolCalled(called) => {
                let data = &called.data;
                if self.finished_tools.contains(&part_key(&message, &data.id)) {
                    return Some(Output::default());
                }
                let part = current(&data.id);
                let state = ToolPartState::Running(SessionMessageToolStateRunning {
                    status: "running".into(),
                    input: data.input.clone(),
                    metadata: Default::default(),
                });
                let name = part.as_ref().map_or("tool".into(), |part| part.name.clone());
                let created = part.as_ref().map_or(called.created, |part| part.time.created);
                let mut item = tool(&data.id, name, state, time(created, Some(called.created), None));
                item.executed = Some(data.executed);
                item.native = data.native.clone();
                item
            }
            V2Event::SessionToolProgress(progress) => {
                let data = &progress.data;
                if self.finished_tools.contains(&part_key(&message, &data.id)) {
                    return Some(Output::default());
                }
                let part = current(&data.id);
                let state = ToolPartState::Running(SessionMessageToolStateRunning {
                    status: "running".into(),
                    input: input_of(&part),
                    metadata: data.metadata.clone(),
                });
                let name = part.as_ref().map_or("tool".into(), |part| part.name.clone());
                let created = part.as_ref().map_or(progress.created, |part| part.time.created);
                let ran = part.as_ref().and_then(|part| part.time.ran).unwrap_or(progress.created);
                let mut item = tool(&data.id, name, state, time(created, Some(ran), None));
                item.executed = part.as_ref().and_then(|part| part.executed);
                item.native = part.as_ref().and_then(|part| part.native.clone());
                item
            }
            V2Event::SessionToolSuccess(success) => {
                let data = &success.data;
                let part = current(&data.id);
                let state = ToolPartState::Completed(SessionMessageToolStateCompleted {
                    status: "completed".into(),
                    input: input_of(&part),
                    content: data.content.clone(),
                    metadata: data.metadata.clone(),
                });
                let item = self.finished_part(part, &data.id, state, success.created, data.native.as_ref());
                SessionMessageAssistantTool { executed: Some(data.executed), ..item }
            }
            V2Event::SessionToolFailed(failed) => {
                let data = &failed.data;
                let part = current(&data.id);
                let state = ToolPartState::Error(SessionMessageToolStateError {
                    status: "error".into(),
                    input: input_of(&part),
                    error: data.error.clone(),
                    content: data.content.clone(),
                    metadata: data.metadata.clone(),
                });
                let item = self.finished_part(part, &data.id, state, failed.created, data.native.as_ref());
                SessionMessageAssistantTool { executed: Some(data.executed), ..item }
            }
            _ => return None,
        };
        Some(self.render_tool(&message, &part, true))
    }

    /// The part a `session.tool.success` or `.failed` event finishes, with the native fields merged.
    fn finished_part(
        &self,
        part: Option<SessionMessageAssistantTool>,
        id: &str,
        state: SessionMessageAssistantToolState,
        created: f64,
        native: Option<&opencode_api::generated::SessionMessageNative>,
    ) -> SessionMessageAssistantTool {
        let previous = part.as_ref().and_then(|part| part.native.clone());
        let native = match native {
            Some(native) => {
                let mut merged = previous.unwrap_or_default();
                merged.extend(native.iter().map(|(key, value)| (key.clone(), value.clone())));
                Some(merged)
            }
            None => previous,
        };
        SessionMessageAssistantTool {
            r#type: "tool".into(),
            id: id.to_owned(),
            name: part.as_ref().map_or("tool".into(), |part| part.name.clone()),
            executed: None,
            native,
            state,
            time: SessionMessageAssistantToolTime {
                created: part.as_ref().map_or(created, |part| part.time.created),
                ran: part.as_ref().and_then(|part| part.time.ran),
                completed: Some(created),
            },
        }
    }
}

/// The session an event belongs to, for the events the transcript reads (`form.created` names it in its form).
fn session_of(event: &V2Event) -> Option<&str> {
    Some(match event {
        V2Event::SessionRenamed(event) => event.data.session_id.as_str(),
        V2Event::SessionInboxEnqueued(event) => event.data.session_id.as_str(),
        V2Event::SessionInboxDelivered(event) => event.data.session_id.as_str(),
        V2Event::SessionInboxCancelled(event) => event.data.session_id.as_str(),
        V2Event::SessionStepStarted(event) => event.data.session_id.as_str(),
        V2Event::SessionTextDelta(event) => event.data.session_id.as_str(),
        V2Event::SessionTextEnded(event) => event.data.session_id.as_str(),
        V2Event::SessionReasoningDelta(event) => event.data.session_id.as_str(),
        V2Event::SessionReasoningEnded(event) => event.data.session_id.as_str(),
        V2Event::SessionStepEnded(event) => event.data.session_id.as_str(),
        V2Event::SessionStepFailed(event) => event.data.session_id.as_str(),
        V2Event::SessionExecutionStarted(event) => event.data.session_id.as_str(),
        V2Event::SessionExecutionSucceeded(event) => event.data.session_id.as_str(),
        V2Event::SessionExecutionFailed(event) => event.data.session_id.as_str(),
        V2Event::SessionExecutionInterrupted(event) => event.data.session_id.as_str(),
        V2Event::SessionToolInputStarted(event) => event.data.session_id.as_str(),
        V2Event::SessionToolInputDelta(event) => event.data.session_id.as_str(),
        V2Event::SessionToolInputEnded(event) => event.data.session_id.as_str(),
        V2Event::SessionToolCalled(event) => event.data.session_id.as_str(),
        V2Event::SessionToolProgress(event) => event.data.session_id.as_str(),
        V2Event::SessionToolSuccess(event) => event.data.session_id.as_str(),
        V2Event::SessionToolFailed(event) => event.data.session_id.as_str(),
        V2Event::SessionSkillActivated(event) => event.data.session_id.as_str(),
        V2Event::SessionShellStarted(event) => event.data.session_id.as_str(),
        V2Event::SessionShellEnded(event) => event.data.session_id.as_str(),
        V2Event::SessionCompactionStarted(event) => event.data.session_id.as_str(),
        V2Event::SessionCompactionDelta(event) => event.data.session_id.as_str(),
        V2Event::SessionCompactionEnded(event) => event.data.session_id.as_str(),
        V2Event::SessionCompactionFailed(event) => event.data.session_id.as_str(),
        V2Event::PermissionAsked(event) => event.data.session_id.as_str(),
        V2Event::PermissionReplied(event) => event.data.session_id.as_str(),
        V2Event::FormCreated(event) => event.data.form.session_id.as_str(),
        V2Event::FormReplied(event) => event.data.session_id.as_str(),
        V2Event::FormCancelled(event) => event.data.session_id.as_str(),
        _ => return None,
    })
}

/// The assistant message of a `session.tool.*` event.
fn tool_message(event: &V2Event) -> Option<&str> {
    Some(match event {
        V2Event::SessionToolInputStarted(event) => event.data.assistant_message_id.as_str(),
        V2Event::SessionToolInputDelta(event) => event.data.assistant_message_id.as_str(),
        V2Event::SessionToolInputEnded(event) => event.data.assistant_message_id.as_str(),
        V2Event::SessionToolCalled(event) => event.data.assistant_message_id.as_str(),
        V2Event::SessionToolProgress(event) => event.data.assistant_message_id.as_str(),
        V2Event::SessionToolSuccess(event) => event.data.assistant_message_id.as_str(),
        V2Event::SessionToolFailed(event) => event.data.assistant_message_id.as_str(),
        _ => return None,
    })
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

/// `errorMessage`: the message, else a fallback (the structured error has no `_tag`).
fn error_message(error: &SessionStructuredError) -> String {
    if error.message.is_empty() { "Session execution failed".to_owned() } else { error.message.clone() }
}

fn skill_commit(message: &str, name: &str) -> Commit {
    Commit::new(EntryKind::System, Source::System, Phase::Start, format!("→ Skill \"{name}\""))
        .message(message)
        .part_id(format!("skill:{message}"))
}

/// `shellCommit`: a direct shell call draws `$ command` at its start and its merged output as progress.
fn shell_commit(id: &str, command: &str, text: &str, phase: Phase, state: ToolState) -> Commit {
    let mut commit = Commit::new(EntryKind::Tool, Source::Tool, phase, text).part_id(format!("shell:{id}"));
    commit.tool = Some("shell".into());
    commit.shell = Some(command.to_owned());
    commit.tool_state = Some(state);
    commit
}

/// `shellTerminal`: the output of a finished shell, and an error line unless it exited with 0.
fn shell_terminal(
    id: &str,
    command: &str,
    status: &str,
    exit: Option<String>,
    output: &SessionMessageShellOutput,
) -> Vec<Commit> {
    let incomplete = output.truncated || output.cursor < output.size;
    let newline = if output.output.ends_with('\n') || output.output.is_empty() { "" } else { "\n" };
    let marker = if incomplete { format!("{newline}[output truncated]") } else { String::new() };
    let text = format!("{}{marker}", output.output);
    let error = match (status, exit.as_deref()) {
        ("exited", Some("0")) => None,
        ("exited", exit) => Some(format!("Shell exited with code {}", exit.unwrap_or("unknown"))),
        (status, _) => Some(format!("Shell {status}")),
    };
    let Some(error) = error else {
        return vec![shell_commit(id, command, &text, Phase::Progress, ToolState::Completed)];
    };
    let mut commits = Vec::new();
    if !text.is_empty() {
        commits.push(shell_commit(id, command, &text, Phase::Progress, ToolState::Running));
    }
    let mut failed = shell_commit(id, command, &error, Phase::Final, ToolState::Error);
    failed.tool_error = Some(error);
    commits.push(failed);
    commits
}

fn compaction_header(message: &str) -> Commit {
    let mut commit = Commit::new(EntryKind::System, Source::System, Phase::Start, "Compaction")
        .message(message)
        .part_id("compaction:header");
    commit.compaction = true;
    commit
}

fn compaction_summary(message: &str, text: &str, phase: Phase) -> Commit {
    Commit::new(EntryKind::Assistant, Source::Assistant, phase, text).message(message).part_id("compaction:summary")
}

/// `SessionMessage.ID.fromEvent`.
fn message_from_event(id: &str) -> String {
    match id.strip_prefix("evt_") {
        Some(rest) => format!("msg_{rest}"),
        None => id.to_owned(),
    }
}

/// What the network side posts to the UI thread.
pub enum Incoming {
    /// The stream (re)connected and the messages were listed.
    Hydrated {
        messages: Vec<SessionMessageInfo>,
        active: bool,
    },
    Event(Box<V2Event>),
    /// The stream dropped; it reconnects.
    Disconnected(String),
}

/// `projectedMessages`: the newest `limit` messages, oldest first.
pub async fn messages(client: &Client, session: &str, limit: u32) -> Result<Vec<SessionMessageInfo>, String> {
    let input = MessageListInput {
        session_id: SessionID(session.to_owned()),
        limit: Some(i64::from(limit)),
        order: Some(MessageListInputOrder::Desc),
        ..Default::default()
    };
    let call = Client::message_list_call(&input).map_err(|error| error.to_string())?;
    let list: Value = client.json(call).await.map_err(|error| error.to_string())?;
    let data = list["data"].as_array().map(Vec::as_slice).unwrap_or_default();
    Ok(data.iter().rev().map(decode_message).collect())
}

/// Decodes a listed message once, at the boundary. A message this client cannot read is kept as unknown, so one
/// bad message does not fail the list.
fn decode_message(value: &Value) -> SessionMessageInfo {
    SessionMessageInfo::deserialize(value).unwrap_or_else(|error| {
        log::warn!("mini could not decode a message: {error}");
        SessionMessageInfo::Unknown(value.clone())
    })
}

/// Whether the session is running (`session.active`).
pub async fn active(client: &Client, session: &str) -> bool {
    let Ok(call) = Client::session_active_call() else { return false };
    client.json::<Value>(call).await.is_ok_and(|active| active["data"].get(session).is_some())
}

/// Lists the messages and whether the session runs, as a hydration does.
pub async fn hydration(client: &Client, session: &str, limit: u32) -> Result<(Vec<SessionMessageInfo>, bool), String> {
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
    let mut events = opencode_api::events::raw::<V2Event>(client);
    match events.next().await {
        Some(Ok(V2Event::ServerConnected(_))) => {}
        Some(Err(error)) if !matches!(error, Error::MalformedResponse(_)) => return Err(error.to_string()),
        _ => return Err("Event stream disconnected".into()),
    }
    // Events that arrive meanwhile wait in the stream, so they reach the UI after the hydration.
    let (messages, active) = hydration(client, session, limit).await?;
    if !post(proxy, Incoming::Hydrated { messages, active }).await {
        return Ok(());
    }
    while let Some(event) = events.next().await {
        let event = match event {
            Ok(event) => event,
            // An event this client cannot decode is skipped; the stream goes on.
            Err(Error::MalformedResponse(error)) => {
                log::warn!("mini could not decode an event: {error}");
                continue;
            }
            Err(error) => return Err(error.to_string()),
        };
        if !post(proxy, Incoming::Event(Box::new(event))).await {
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

    /// A listed message, with the fields the tests do not care about filled in.
    pub(crate) fn message(value: Value) -> SessionMessageInfo {
        let mut value = value;
        value["time"] = json!({ "created": 1 });
        if value["type"] == "assistant" {
            value["agent"] = json!("build");
            value["model"] = json!({ "id": "model", "providerID": "demo" });
        }
        SessionMessageInfo::deserialize(&value).unwrap()
    }

    /// A live event of `ses_1` unless `data` names another session.
    pub(crate) fn event(kind: &str, data: Value) -> V2Event {
        let mut data = data;
        if data.get("sessionID").is_none() {
            data["sessionID"] = json!("ses_1");
        }
        let event = json!({ "id": "evt_1", "created": 1, "type": kind,
            "durable": { "aggregateID": "ses_1", "seq": 1, "version": 1 }, "data": data });
        V2Event::deserialize(&event).unwrap()
    }

    fn delta(message: &str, text: &str) -> V2Event {
        event("session.text.delta", json!({ "assistantMessageID": message, "ordinal": 0, "delta": text }))
    }

    fn history() -> Vec<SessionMessageInfo> {
        vec![
            message(json!({ "id": "msg_u1", "type": "user", "text": "first" })),
            message(json!({ "id": "msg_a1", "type": "assistant", "content": [
                { "type": "reasoning", "text": "hmm" },
                { "type": "text", "text": "answer" },
            ] })),
            message(json!({ "id": "msg_a2", "type": "assistant", "content": [],
                "error": { "type": "provider", "message": "Boom" } })),
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
            &[message(json!({ "id": "msg_a", "type": "assistant", "content": [{ "type": "text", "text": "Hello" }] }))],
            true,
        );
        assert!(transcript.event(&delta("msg_a", "Hel")).commits.is_empty());
        assert!(transcript.event(&delta("msg_a", "lo")).commits.is_empty());
        assert_eq!(texts(&transcript.event(&delta("msg_a", " world"))), [(EntryKind::Assistant, " world".into())]);
        let ended =
            event("session.text.ended", json!({ "assistantMessageID": "msg_a", "ordinal": 0, "text": "Hello world!" }));
        assert_eq!(texts(&transcript.event(&ended)), [(EntryKind::Assistant, "!".into())]);
        let other = event(
            "session.text.delta",
            json!({ "sessionID": "ses_2", "assistantMessageID": "msg_b", "ordinal": 0, "delta": "x" }),
        );
        assert!(transcript.event(&other).commits.is_empty());
    }

    #[test]
    fn with_tools_hidden_text_waits_for_its_step_and_tool_messages_stay_quiet() {
        let mut transcript = Transcript::new("ses_1", true, false, true, None);
        transcript.hydrate(&[], true);
        assert!(transcript.event(&delta("msg_a", "Hello")).commits.is_empty());
        assert!(transcript.event(&delta("msg_a", " there")).commits.is_empty());
        let tokens = json!({ "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } });
        let ended = event(
            "session.step.ended",
            json!({ "assistantMessageID": "msg_a", "finish": "stop", "cost": 0, "tokens": tokens }),
        );
        assert_eq!(texts(&transcript.event(&ended)), [(EntryKind::Assistant, "Hello there".into())]);
        assert!(transcript.event(&delta("msg_b", "Let me look")).commits.is_empty());
        let tool = event(
            "session.tool.called",
            json!({ "assistantMessageID": "msg_b", "id": "call_1", "input": {}, "executed": true }),
        );
        let output = transcript.event(&tool);
        assert!(output.commits.is_empty());
        assert_eq!(output.footer.len(), 1);
        assert!(transcript.event(&event("session.execution.succeeded", json!({}))).commits.is_empty());
    }

    #[test]
    fn an_admitted_prompt_prints_when_delivered() {
        let mut transcript = Transcript::new("ses_1", true, true, true, None);
        transcript.hydrate(&[], false);
        assert!(transcript.admitted("msg_p", "hi").commits.is_empty());
        let output = transcript.event(&event("session.inbox.delivered", json!({ "inboxID": "msg_p" })));
        assert_eq!(texts(&output), [(EntryKind::User, "hi".into())]);
        assert_eq!(output.patch.unwrap().status.as_deref(), Some("waiting for assistant"));
        // The listed user message does not print it again.
        let listed = message(json!({ "id": "msg_p", "type": "user", "text": "hi" }));
        assert!(transcript.message(&listed, true).commits.is_empty());
    }

    #[test]
    fn a_resize_replay_lists_again_then_restores_local_rows_and_waiting_events() {
        let mut transcript = Transcript::new("ses_1", true, true, true, None);
        transcript.hydrate(&history(), false);
        // A live answer the list does not have yet, and a local error.
        transcript.event(&delta("msg_live", "streamed"));
        transcript.remember(&Commit::error("send failed").message("msg_local"));
        transcript.begin_replay();
        assert!(transcript.event(&delta("msg_live", " more")).commits.is_empty());
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
    fn live_tool_events_print_the_start_new_output_and_the_end_once() {
        let mut transcript = Transcript::new("ses_1", true, true, true, None);
        transcript.hydrate(&[], true);
        let call = |kind: &str, data: Value| {
            let mut data = data;
            data["assistantMessageID"] = json!("msg_a");
            data["id"] = json!("call_1");
            event(kind, data)
        };
        let tools = |output: Output| -> Vec<(Phase, String)> {
            output.commits.iter().map(|commit| (commit.phase, commit.text.clone())).collect()
        };
        assert!(transcript.event(&call("session.tool.input.started", json!({ "name": "bash" }))).commits.is_empty());
        let called = call("session.tool.called", json!({ "input": { "command": "ls" }, "executed": true }));
        let output = transcript.event(&called);
        assert_eq!(output.patch.unwrap().status.as_deref(), Some("running shell"));
        assert_eq!(output.commits[0].tool.as_deref(), Some("shell"));
        let success = call(
            "session.tool.success",
            json!({ "content": [{ "type": "text", "text": "a\n" }], "metadata": { "exit": 0 }, "executed": true }),
        );
        assert_eq!(tools(transcript.event(&success)), [(Phase::Progress, "a\n".into())]);
        assert!(transcript.event(&success).commits.is_empty(), "a finished tool prints once");
        let listed = message(json!({ "id": "msg_a", "type": "assistant", "content": [{ "type": "tool", "id": "call_1",
            "name": "bash", "state": { "status": "completed", "input": {}, "content": [] }, "time": { "created": 1 } }] }));
        assert!(transcript.message(&listed, true).commits.is_empty(), "nor when listed later");
    }

    /// One message the client cannot read does not fail the list.
    #[test]
    fn an_unreadable_message_is_kept_as_unknown() {
        let value = json!({ "id": "msg_a", "type": "assistant", "content": "not a list" });
        assert!(matches!(decode_message(&value), SessionMessageInfo::Unknown(_)));
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
