//! The session transcript as scrollback commits (`stream-v2.transport.ts`, `stream-v2.fragment.ts`): hydration
//! from the message list, live events, and replay on resume and resize.
//!
//! [`Transcript`] is a plain state machine on the UI thread: it turns messages and events into [`Commit`]s and
//! remembers what it already showed, so a message that arrives both live and in a later list prints once. The
//! network side ([`connect`], [`messages`]) runs on tokio and posts what it reads to the UI thread.
//!
//! Tools, shells, permissions, and forms reach this module but are drawn by M.3 and M.4: tool parts go through
//! [`crate::tools::commits`], and requests through [`crate::footers`]. Events of other sessions and this session's
//! tool events also go to the subagent tracker ([`crate::subagents`]) through [`Output::subagents`].

use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use opencode_api::error::Error;
use opencode_api::generated::{
    ExperimentalSessionWaitInput, MessageListInput, MessageListInputOrder, ModelDefaultInput, PromptFileAttachment,
    PromptFileSource, PromptSkillAttachment, SessionID, SessionInboxInfo, SessionInboxItem, SessionInboxListInput,
    SessionInboxUser, SessionInterruptInput, SessionMessageAssistant,
    SessionMessageAssistantContentItem as ContentItem, SessionMessageAssistantToolState,
    SessionMessageAssistantToolState as ToolPartState, SessionMessageAssistantToolTime, SessionMessageCompaction,
    SessionMessageShellExit, SessionMessageShellOutput, SessionMessageToolStateCompleted, SessionMessageToolStateError,
    SessionMessageToolStateRunning, SessionMessageToolStateStreaming, SessionStructuredError,
};
use opentui::app::ProxyError;
use serde::Deserialize;
use tokio::sync::watch;

use crate::footers::Requests;
use crate::prelude::*;
use crate::scrollback::{EntryKind, Phase, Source, ToolState};

/// The owner of the forms that belong to no session (`sessionID: "global"`).
pub const GLOBAL: &str = "global";
/// `--replay-limit`'s default: the newest messages a replay lists.
pub const DEFAULT_REPLAY_LIMIT: u32 = 200;
/// `LOCAL_REPLAY_ROW_LIMIT`: rows printed only locally (errors, prompts in flight) that a resize replays.
pub const LOCAL_ROW_LIMIT: usize = 100;
/// `RESIZE_DELAY`.
pub const RESIZE_DELAY: Duration = Duration::from_millis(250);
/// The events a resize replay holds while it lists. TS holds any number
/// (`parity/deviations/O92-mini-relist-overflow.md`).
pub const RELIST_LIMIT: usize = 4096;

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

    /// A live delta: the length of the text before it, or `None` when a list already showed it. TS returns the
    /// previous text; copying it here for every delta would copy the whole prefix each time.
    pub fn delta(&mut self, fragment: &Fragment, delta: &str) -> Option<usize> {
        let state = self.0.entry(fragment.clone()).or_default();
        // Replay may start after an unseen prefix, so a covered chunk is consumed from anywhere in the projection.
        if let Some(projected) = &mut state.projected
            && let Some(at) = projected.find(delta)
        {
            projected.drain(..at + delta.len());
            return None;
        }
        let previous = state.text.len();
        state.text.push_str(delta);
        Some(previous)
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
    /// Events for the footer views of M.3 (permissions, forms, the queue), and the forms of no session
    /// (`sessionID: "global"`).
    pub footer: Vec<V2Event>,
    /// Events for the subagent tracker: other sessions' events, and this session's tool events, which name the
    /// child sessions its subagent calls start.
    pub subagents: Vec<V2Event>,
    /// The resize replay's events overflowed and were dropped: a new read lists again under this ticket.
    pub relist: Option<u64>,
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
        self.subagents.extend(other.subagents);
        self.relist = other.relist.or(self.relist);
    }
}

/// A prompt admitted to the inbox but not yet delivered.
#[derive(Clone, Debug, PartialEq)]
struct Pending {
    text: String,
    files: Vec<PromptFileAttachment>,
    skills: Vec<PromptSkillAttachment>,
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
    /// The resize replay in flight, and the events that wait for it.
    relist: Option<Relist>,
    /// The tickets handed out to resize replays.
    relists: u64,
    /// The events a resize replay holds ([`RELIST_LIMIT`]).
    relist_limit: usize,
    /// Events were dropped since the last relist cleared the terminal, so the next one must clear it.
    lost: bool,
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
    /// Prompts admitted by this client or enqueued live, until delivered (`admitted`).
    admitted: HashSet<String>,
    /// The prompt turn this client waits for (`state.wait`).
    wait: Option<Wait>,
}

/// A resize replay in flight. Its read applies only while it holds the current ticket.
#[derive(Debug)]
struct Relist {
    ticket: u64,
    events: Vec<V2Event>,
}

/// A prompt turn in flight (`Wait`): the error the session's terminal event names, shown after it settles unless a
/// step already showed one.
#[derive(Debug, Default)]
struct Wait {
    message_id: String,
    failure_message_id: String,
    promoted: bool,
    promotion_observed: bool,
    interrupted: bool,
    failure_rendered: bool,
    terminal_error: Option<String>,
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

/// Whether `commit` replaces the local row `last`: both stream the same part (`rememberLocal`).
fn joins(last: &Commit, commit: &Commit) -> bool {
    matches!(commit.kind, EntryKind::Assistant | EntryKind::Reasoning)
        && last.kind == commit.kind
        && last.source == commit.source
        && last.message_id == commit.message_id
        && last.part_id == commit.part_id
        && last.tool == commit.tool
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
            relist: None,
            relists: 0,
            relist_limit: RELIST_LIMIT,
            lost: false,
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
            admitted: HashSet::new(),
            wait: None,
        }
    }

    /// A prompt turn starts (`runTurnWait`).
    pub fn begin_wait(&mut self, message_id: &str) {
        self.wait = Some(Wait {
            message_id: message_id.to_owned(),
            failure_message_id: message_id.to_owned(),
            ..Wait::default()
        });
    }

    /// The two-press gesture interrupts the turn: its own `user` interruption shows no error.
    pub fn interrupt_wait(&mut self) {
        if let Some(wait) = &mut self.wait {
            wait.interrupted = true;
        }
    }

    /// The turn settled: the terminal error no step showed, under the message that failed.
    pub fn end_wait(&mut self) -> Option<Commit> {
        let wait = self.wait.take()?;
        let error = wait.terminal_error.filter(|_| !wait.failure_rendered)?;
        Some(Commit::error(error).message(&wait.failure_message_id))
    }

    /// `promoteWait`: a new message of the turn was delivered, so the failure tracking starts over for it.
    fn promote_wait(&mut self, observed: bool, message_id: Option<&str>) {
        let Some(wait) = &mut self.wait else { return };
        let message_id = message_id.unwrap_or(&wait.message_id).to_owned();
        let transition =
            message_id != wait.failure_message_id || if observed { !wait.promotion_observed } else { !wait.promoted };
        wait.promoted = true;
        if observed {
            wait.promotion_observed = true;
        }
        if transition {
            wait.failure_message_id = message_id;
            wait.failure_rendered = false;
            wait.terminal_error = None;
        }
    }

    fn failure_rendered(&mut self) {
        if let Some(wait) = &mut self.wait {
            wait.failure_rendered = true;
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

    /// The listed pending prompts replace the pending ones (`hydrate`), so each prints once it is delivered.
    pub fn inbox(&mut self, items: &[SessionInboxUser]) {
        self.pending = items
            .iter()
            .map(|item| {
                let files = item.payload.files.clone().unwrap_or_default();
                let skills = item.payload.skills.clone().unwrap_or_default();
                (item.id.as_str().to_owned(), Pending { text: item.payload.text.clone(), files, skills })
            })
            .collect();
    }

    /// Starts a resize replay: events wait until [`Self::replayed`]. Its read applies while
    /// [`Self::relisting`] holds for the returned ticket.
    pub fn begin_replay(&mut self) -> u64 {
        self.relists += 1;
        self.relist = Some(Relist { ticket: self.relists, events: Vec::new() });
        self.relists
    }

    pub fn replaying(&self) -> bool {
        self.relist.is_some()
    }

    /// Whether the resize replay of `ticket` is still the one in flight.
    pub fn relisting(&self, ticket: u64) -> bool {
        self.relist.as_ref().is_some_and(|relist| relist.ticket == ticket)
    }

    /// Whether events were dropped since the last relist cleared the terminal: until one clears it again, rows may
    /// be missing.
    pub fn lost(&self) -> bool {
        self.lost
    }

    /// The stream dropped. A resize replay in flight is abandoned, with its events, as TS abandons one of a stale
    /// attempt: the reconnect lists everything again, and a resize relist must not apply its older list after it.
    pub fn disconnected(&mut self) {
        self.connected = false;
        self.relist = None;
    }

    /// Ends a resize replay (`performResizeReplay`) after the terminal was cleared: the listed messages, then the
    /// rows only this client printed, then the events that waited.
    pub fn replayed(&mut self, messages: &[SessionMessageInfo], active: bool) -> Output {
        let buffered = self.relist.take().map(|relist| relist.events).unwrap_or_default();
        self.lost = false;
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
        for event in self.relist.take().map(|relist| relist.events).unwrap_or_default() {
            output.extend(self.event(&event));
        }
        output
    }

    fn restore(&mut self, commit: &Commit) -> Option<Commit> {
        if let (Some(_), Some(message), Some(part)) = (&commit.image, &commit.message_id, &commit.part_id) {
            return self.image_ids.insert(part_key(message, part)).then(|| commit.clone());
        }
        if let (Some(message), Some(part), EntryKind::Assistant | EntryKind::Reasoning) =
            (&commit.message_id, &commit.part_id, commit.kind)
        {
            let prefix = if commit.kind == EntryKind::Reasoning { "Thinking: " } else { "" };
            let text = commit.text.strip_prefix(prefix).unwrap_or(&commit.text);
            let fragment = Fragment { message_id: message.clone(), part_id: part.clone() };
            match self.fragments.restore(&fragment, text) {
                Restore::Covered => return None,
                Restore::Append(suffix) if suffix.is_empty() => return None,
                Restore::Append(suffix) if suffix == text => return Some(commit.clone()),
                Restore::Append(suffix) => return Some(Commit { text: suffix, ..commit.clone() }),
                // A conflict falls through: the row shows unless its message was listed.
                Restore::Conflict => {}
            }
        }
        if commit.kind == EntryKind::Error
            && let Some(message) = &commit.message_id
        {
            return self.errors.insert(message.clone()).then(|| commit.clone());
        }
        if commit.message_id.as_ref().is_some_and(|message| self.message_ids.contains(message)) {
            return None;
        }
        // A prompt the list did not have yet counts as shown, so it does not print again once listed. TS does not
        // record it (`parity/deviations/O89-mini-restored-prompt.md`).
        if commit.kind == EntryKind::User
            && let Some(message) = &commit.message_id
        {
            self.message_ids.insert(message.clone());
        }
        Some(commit.clone())
    }

    /// Remembers rows this client printed itself, for a resize replay (`rememberLocal`).
    pub fn remember(&mut self, commit: &Commit) {
        if self.local.last().is_some_and(|last| joins(last, commit)) {
            self.local.pop();
        }
        self.local.push(commit.clone());
        let excess = self.local.len().saturating_sub(LOCAL_ROW_LIMIT);
        self.local.drain(..excess);
    }

    /// Commits of a live event remembered as local rows: streamed text is remembered whole.
    fn remember_all(&mut self, commits: &[Commit]) {
        if self.initial || self.relist.is_some() {
            return;
        }
        for commit in commits {
            let whole = match (&commit.message_id, &commit.part_id, commit.kind) {
                (Some(message), Some(part), EntryKind::Assistant | EntryKind::Reasoning) => {
                    self.fragments.value(&Fragment { message_id: message.clone(), part_id: part.clone() })
                }
                _ => None,
            };
            let prefix = if commit.kind == EntryKind::Reasoning && whole.is_some_and(|text| !text.is_empty()) {
                "Thinking: "
            } else {
                ""
            };
            // The row this one replaces already holds the text before this delta: extend it in place rather than
            // copying the whole text for every delta.
            if let Some(text) = whole
                && let Some(last) = self.local.last_mut().filter(|last| joins(last, commit))
                && last.text.len() + commit.text.len() == prefix.len() + text.len()
                && text.ends_with(commit.text.as_str())
            {
                let text = std::mem::take(&mut last.text) + &commit.text;
                *last = Commit { text, ..commit.clone() };
                continue;
            }
            let whole = whole.map(|text| format!("{prefix}{text}"));
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

    pub fn admitted(
        &mut self,
        message_id: &str,
        text: &str,
        files: &[PromptFileAttachment],
        skills: &[PromptSkillAttachment],
    ) -> Output {
        if self.promoted.contains(message_id) {
            return self.user(message_id, text, files, skills, true);
        }
        self.admitted.insert(message_id.to_owned());
        let pending = Pending { text: text.to_owned(), files: files.to_vec(), skills: skills.to_vec() };
        self.pending.insert(message_id.to_owned(), pending);
        Output::default()
    }

    /// `renderUser`: the skills it names while tools show, the prompt once, then its images once each.
    fn user(
        &mut self,
        message_id: &str,
        text: &str,
        files: &[PromptFileAttachment],
        skills: &[PromptSkillAttachment],
        render: bool,
    ) -> Output {
        let visible = !self.message_ids.insert(message_id.to_owned());
        let images: Vec<Commit> = user_image_commits(message_id, files)
            .into_iter()
            .filter(|commit| {
                self.image_ids.insert(part_key(message_id, commit.part_id.as_deref().unwrap_or_default())) && render
            })
            .collect();
        if !render {
            return Output::default();
        }
        let mut commits = Vec::new();
        if !visible && self.tools {
            let mut seen = HashSet::new();
            commits.extend(
                skills
                    .iter()
                    .filter(|skill| seen.insert(skill.id.as_str()))
                    .map(|skill| skill_commit(message_id, skill.name.as_str(), skill.id.as_str())),
            );
        }
        if !visible && !text.trim().is_empty() {
            commits.push(Commit::new(EntryKind::User, Source::System, Phase::Start, text).message(message_id));
        }
        commits.extend(images);
        Output::commits(commits)
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
        let Some(index) = self.quiet.iter().position(|(id, _)| id == message) else { return Vec::new() };
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
                let admitted = self.admitted.remove(id);
                let waiting =
                    self.wait.as_ref().is_some_and(|wait| wait.message_id == id && wait.failure_message_id == id);
                if admitted || waiting {
                    self.promote_wait(false, Some(id));
                }
                self.pending.remove(id);
                self.promoted.insert(id.to_owned());
                let skills = user.skills.as_deref().unwrap_or_default();
                self.user(id, &user.text, user.files.as_deref().unwrap_or_default(), skills, render)
            }
            SessionMessageInfo::Compaction(compaction) => self.compaction(compaction, render),
            SessionMessageInfo::Assistant(assistant) => self.assistant(assistant, render),
            SessionMessageInfo::Skill(skill) => {
                let id = skill.id.as_str();
                if self.wait.as_ref().is_some_and(|wait| wait.message_id == id) {
                    self.promote_wait(false, None);
                }
                let fresh = self.skill_messages.insert(id.to_owned());
                if !render || !self.tools || !fresh {
                    return Output::default();
                }
                Output::commits(vec![skill_commit(id, skill.name.as_str(), id)])
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
        let visible = !self.message_ids.insert(id.to_owned());
        // A client that attaches while it runs sees no `session.compaction.started` that would set it.
        if matches!(message, SessionMessageCompaction::Running(_)) {
            self.active_compaction = Some(id.to_owned());
        } else if self.active_compaction.as_deref() == Some(id) {
            self.active_compaction = None;
        }
        if visible {
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
            self.failure_rendered();
            commits.push(Commit::error(error_message(error)).message(id));
        }
        Output::commits(commits)
    }

    /// `apply`: one live event. A form of no session goes to the footer; events of other sessions go to the
    /// subagent tracker, and so do this session's tool events.
    pub fn event(&mut self, event: &V2Event) -> Output {
        if let Some(relist) = &mut self.relist {
            if relist.events.len() < self.relist_limit {
                relist.events.push(event.clone());
                return Output::default();
            }
            // Bounded storage cannot replay a slow read exactly: drop the events and list again after them.
            self.relists += 1;
            *relist = Relist { ticket: self.relists, events: Vec::new() };
            self.lost = true;
            return Output { relist: Some(self.relists), ..Output::default() };
        }
        let Some(session) = session_of(event) else { return Output::default() };
        let form = matches!(event, V2Event::FormCreated(_) | V2Event::FormReplied(_) | V2Event::FormCancelled(_));
        if session == GLOBAL && form {
            return Output { footer: vec![event.clone()], ..Output::default() };
        }
        if session != self.session_id.as_str() {
            return Output { subagents: vec![event.clone()], ..Output::default() };
        }
        let mut output = self.apply(event);
        self.remember_all(&output.commits);
        if tool_message(event).is_some() {
            output.subagents.push(event.clone());
        }
        output
    }

    fn apply(&mut self, event: &V2Event) -> Output {
        let footer = || Output { footer: vec![event.clone()], ..Output::default() };
        match event {
            V2Event::SessionRenamed(renamed) => Output { title: Some(renamed.data.title.clone()), ..Output::default() },
            V2Event::SessionInboxEnqueued(enqueued) => {
                let SessionInboxItem::User(item) = &enqueued.data.item else { return Output::default() };
                let files = item.payload.files.as_deref().unwrap_or_default();
                let skills = item.payload.skills.as_deref().unwrap_or_default();
                let mut output = self.admitted(enqueued.data.inbox_id.as_str(), &item.payload.text, files, skills);
                output.footer.push(event.clone());
                output
            }
            V2Event::SessionInboxDelivered(delivered) => {
                let id = delivered.data.inbox_id.as_str();
                self.promote_wait(true, Some(id));
                self.admitted.remove(id);
                self.promoted.insert(id.to_owned());
                let mut output = match self.pending.remove(id) {
                    Some(pending) => self.user(id, &pending.text, &pending.files, &pending.skills, true),
                    None => Output::default(),
                };
                output.extend(Output::patch(true, "waiting for assistant"));
                output.footer.push(event.clone());
                output
            }
            V2Event::SessionInboxCancelled(cancelled) => {
                self.admitted.remove(cancelled.data.inbox_id.as_str());
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
                    Some(previous) if self.thinking => {
                        let text = if previous == 0 { format!("Thinking: {}", data.delta) } else { data.delta.clone() };
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
                self.failure_rendered();
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
                if let Some(wait) = &mut self.wait {
                    match event {
                        V2Event::SessionExecutionFailed(failed) if !wait.failure_rendered => {
                            wait.terminal_error = Some(error_message(&failed.data.error));
                        }
                        V2Event::SessionExecutionInterrupted(interrupted)
                            if !(wait.interrupted
                                && interrupted.data.reason
                                    == opencode_api::generated::SessionExecutionInterruptedDataReason::User) =>
                        {
                            let reason = interrupted.data.reason.as_str();
                            wait.terminal_error = Some(format!("Session interrupted: {reason}"));
                        }
                        _ => {}
                    }
                }
                Output { commits, ..Output::patch(false, "") }
            }
            V2Event::SessionSkillActivated(activated) => {
                let message = message_from_event(activated.id.as_str());
                if self.wait.as_ref().is_some_and(|wait| wait.message_id == message) {
                    self.promote_wait(true, None);
                }
                if !self.skill_messages.insert(message.clone()) || !self.tools {
                    return Output::default();
                }
                Output::commits(vec![skill_commit(&message, activated.data.name.as_str(), &message)])
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
            V2Event::SessionInboxDeliveryChanged(_)
            | V2Event::PermissionAsked(_)
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
pub(crate) fn session_of(event: &V2Event) -> Option<&str> {
    Some(match event {
        V2Event::SessionRenamed(event) => event.data.session_id.as_str(),
        V2Event::SessionInboxEnqueued(event) => event.data.session_id.as_str(),
        V2Event::SessionInboxDelivered(event) => event.data.session_id.as_str(),
        V2Event::SessionInboxCancelled(event) => event.data.session_id.as_str(),
        V2Event::SessionInboxDeliveryChanged(event) => event.data.session_id.as_str(),
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
pub(crate) fn tool_message(event: &V2Event) -> Option<&str> {
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
pub(crate) fn error_message(error: &SessionStructuredError) -> String {
    if error.message.is_empty() { "Session execution failed".to_owned() } else { error.message.clone() }
}

/// `userImageCommits`: a prompt's images, without repeats of one named inline image (`deduplicateVisibleImages`).
pub(crate) fn user_image_commits(message: &str, files: &[PromptFileAttachment]) -> Vec<Commit> {
    let mut seen: Vec<(String, &str)> = Vec::new();
    files
        .iter()
        .filter(|file| {
            let inline = matches!(file.source, PromptFileSource::Inline(_));
            let Some(mention) = file.mention.as_ref().filter(|_| file.mime.starts_with("image/") && inline) else {
                return true;
            };
            let metadata =
                serde_json::to_string(&(&file.mime, &file.name, &file.description, &mention.text)).unwrap_or_default();
            let key = (metadata, file.data.as_str());
            if seen.contains(&key) {
                return false;
            }
            seen.push(key);
            true
        })
        .filter(|file| file.mime.starts_with("image/"))
        .enumerate()
        .map(|(index, file)| {
            let caption = file
                .name
                .clone()
                .or_else(|| file.mention.as_ref().map(|mention| mention.text.clone()))
                .unwrap_or_else(|| format!("[Image {}]", index + 1));
            let mut commit = Commit::new(EntryKind::User, Source::System, Phase::Final, caption)
                .message(message)
                .part_id(format!("image:{index}"));
            commit.image = Some(format!("data:{};base64,{}", file.mime, file.data.as_str()));
            commit
        })
        .collect()
}

/// `skillCommit`: `skill` is the skill's ID on a user message, else the message's.
fn skill_commit(message: &str, name: &str, skill: &str) -> Commit {
    Commit::new(EntryKind::System, Source::System, Phase::Start, format!("→ Skill \"{name}\""))
        .message(message)
        .part_id(format!("skill:{skill}"))
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
pub(crate) fn message_from_event(id: &str) -> String {
    match id.strip_prefix("evt_") {
        Some(rest) => format!("msg_{rest}"),
        None => id.to_owned(),
    }
}

/// What the network side posts to the UI thread.
pub enum Incoming {
    /// The stream (re)connected and the messages were listed.
    Hydrated {
        /// The session listed, so a hydration that arrives after another session opened is dropped.
        session: String,
        messages: Vec<SessionMessageInfo>,
        /// The sessions running now (`session.active`).
        active: Vec<String>,
        /// The session's pending prompts (`session.inbox.list`).
        inbox: Vec<SessionInboxUser>,
        requests: Requests,
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

/// The sessions running now (`session.active`); none when the read fails.
pub async fn active(client: &Client) -> Vec<String> {
    client.session_active().await.map(|active| active.into_keys().collect()).unwrap_or_default()
}

/// The session's pending user prompts (`session.inbox.list`); none when the read fails.
pub async fn inbox(client: &Client, session: &str) -> Vec<SessionInboxUser> {
    let input = SessionInboxListInput { session_id: SessionID(session.to_owned()) };
    let items = client.session_inbox_list(&input).await.unwrap_or_else(|error| {
        log::warn!("mini could not list the inbox: {error}");
        Vec::new()
    });
    items
        .into_iter()
        .filter_map(|item| match item {
            SessionInboxInfo::User(user) => Some(user),
            _ => None,
        })
        .collect()
}

/// What a hydration lists: the messages, the running sessions, the pending prompts, and the pending requests.
pub type Hydration = (Vec<SessionMessageInfo>, Vec<String>, Vec<SessionInboxUser>, Requests);

/// Lists the messages, the running sessions, the pending prompts, and the requests, as a hydration does. The
/// requests are listed here, after the stream subscribed, so a request asked before the subscription is listed
/// and one asked after it arrives as an event that applies after the list (`hydrate`).
pub async fn hydration(client: &Client, session: &str, directory: &str, limit: u32) -> Result<Hydration, String> {
    let (messages, active, inbox, requests) = futures_util::future::join4(
        messages(client, session, limit),
        active(client),
        inbox(client, session),
        crate::footers::requests(client, session, directory),
    )
    .await;
    Ok((messages?, active, inbox, requests))
}

/// `connect`: subscribes, hydrates after `server.connected`, then forwards events. When the stream drops it finds
/// the service again, which may have restarted on another port or password, and reconnects after 250 ms. Runs
/// until `proxy` closes. `connected` is true from a hydration until the stream drops.
pub async fn connect(
    client: Client,
    session: String,
    directory: String,
    limit: u32,
    proxy: AppProxy,
    connected: watch::Sender<bool>,
) {
    loop {
        let error = match stream(&client, &session, &directory, limit, &proxy, &connected).await {
            Ok(()) => return,
            Err(error) => error,
        };
        connected.send_replace(false);
        if !post(&proxy, Incoming::Disconnected(error)).await {
            return;
        }
        // The following transport leaves the event stream to this loop (`Follow::send`).
        client.transport().reconnect().await;
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

/// One connection. `Ok` means the app is gone.
async fn stream(
    client: &Client,
    session: &str,
    directory: &str,
    limit: u32,
    proxy: &AppProxy,
    connected: &watch::Sender<bool>,
) -> Result<(), String> {
    let mut events = opencode_api::events::raw::<V2Event>(client);
    match events.next().await {
        Some(Ok(V2Event::ServerConnected(_))) => {}
        Some(Err(error)) if !matches!(error, Error::MalformedResponse(_)) => return Err(error.to_string()),
        _ => return Err("Event stream disconnected".into()),
    }
    // Events that arrive meanwhile wait in the stream, so they reach the UI after the hydration.
    let (messages, active, inbox, requests) = hydration(client, session, directory, limit).await?;
    let hydrated = Incoming::Hydrated { session: session.to_owned(), messages, active, inbox, requests };
    if !post(proxy, hydrated).await {
        return Ok(());
    }
    connected.send_replace(true);
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

/// `waitForSession`: `experimental.session.wait`, which returns once the session is idle. The long poll ends with
/// a dropped connection, not with the session, so a transport error waits 250 ms and for the event stream to
/// connect again, then asks again.
pub async fn wait(client: &Client, session: &str, mut connected: watch::Receiver<bool>) -> Result<(), String> {
    let input = ExperimentalSessionWaitInput { session_id: SessionID(session.to_owned()) };
    loop {
        match client.experimental_session_wait(&input).await {
            Err(Error::Transport(error)) => log::info!("mini session wait retries: {error}"),
            result => return result.map_err(|error| error.tui_message()),
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
        connected.wait_for(|connected| *connected).await.map_err(|_| "Event stream closed".to_owned())?;
    }
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

    /// A transport that is always down and counts the times it is asked to find the server again.
    #[derive(Default)]
    struct Down(std::sync::atomic::AtomicUsize);

    impl opencode_api::transport::Transport for Down {
        fn send(
            &self,
            _: opencode_api::transport::Request,
        ) -> futures_util::future::BoxFuture<'_, Result<opencode_api::transport::Response, String>> {
            Box::pin(async { Err("connection refused".to_owned()) })
        }

        fn reconnect(&self) -> futures_util::future::BoxFuture<'_, bool> {
            self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Box::pin(async { false })
        }
    }

    /// A dropped stream finds the service again before it subscribes once more (`stream-v2.transport.ts:1550-1561`),
    /// so a managed service that restarted on another port or password is followed.
    #[tokio::test]
    async fn a_dropped_stream_finds_the_service_again() {
        let down = Arc::new(Down::default());
        let client = Client::with_transport("http://test", down.clone()).unwrap();
        let app = opentui::testing::TestApp::new(10, 2);
        let proxy = app.app().proxy();
        let connected = watch::channel(false).0;
        let _ = tokio::time::timeout(
            Duration::from_millis(600),
            connect(client, "ses_1".into(), "/".into(), 10, proxy, connected),
        )
        .await;
        assert!(down.0.load(std::sync::atomic::Ordering::SeqCst) >= 2);
    }

    /// Fails its first request with a transport error, then answers from `Memory`.
    struct Flaky(std::sync::atomic::AtomicBool, opencode_api::memory::Memory);

    impl opencode_api::transport::Transport for Flaky {
        fn send(
            &self,
            request: opencode_api::transport::Request,
        ) -> futures_util::future::BoxFuture<'_, Result<opencode_api::transport::Response, String>> {
            if !self.0.swap(true, std::sync::atomic::Ordering::SeqCst) {
                return Box::pin(async { Err("connection reset".to_owned()) });
            }
            self.1.send(request)
        }
    }

    /// A session wait that loses its connection asks again once the stream is back, instead of ending the turn
    /// (`waitForSession`).
    #[tokio::test]
    async fn a_session_wait_survives_a_dropped_connection() {
        let memory = opencode_api::memory::Memory::new(vec![opencode_api::memory::Route::json(
            "POST",
            "/api/experimental/session/ses_1/wait",
            204,
            &Value::Null,
        )]);
        let flaky = Arc::new(Flaky(Default::default(), memory.clone()));
        let client = Client::with_transport("http://test", flaky).unwrap();
        let (connected, receiver) = watch::channel(true);
        assert_eq!(wait(&client, "ses_1", receiver).await, Ok(()));
        assert_eq!(memory.requests().len(), 1);
        drop(connected);
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
    fn events_route_to_the_transcript_the_subagents_and_the_footer() {
        let mut transcript = Transcript::new("ses_1", true, true, true, None);
        transcript.hydrate(&[], false);
        let child = transcript.event(&event("session.execution.started", json!({ "sessionID": "ses_child" })));
        assert_eq!((child.commits.len(), child.subagents.len(), child.patch), (0, 1, None));
        let call = event(
            "session.tool.input.started",
            json!({ "assistantMessageID": "msg_a", "id": "call_1",
            "name": "subagent" }),
        );
        assert_eq!(transcript.event(&call).subagents, std::slice::from_ref(&call));
        assert!(transcript.event(&delta("msg_a", "hi")).subagents.is_empty());
        let form = event("form.cancelled", json!({ "sessionID": "global", "id": "frm_1" }));
        let global = transcript.event(&form);
        assert_eq!((global.footer, global.subagents.len()), (vec![form], 0));
        // A pending prompt moved between queue and steer updates the footer (`stream-v2.transport.ts:1080-1085`).
        let changed = event("session.inbox.delivery.changed", json!({ "inboxID": "msg_p", "delivery": "steer" }));
        assert_eq!(transcript.event(&changed).footer, [changed]);
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
        assert!(transcript.admitted("msg_p", "hi", &[], &[]).commits.is_empty());
        let output = transcript.event(&event("session.inbox.delivered", json!({ "inboxID": "msg_p" })));
        assert_eq!(texts(&output), [(EntryKind::User, "hi".into())]);
        assert_eq!(output.patch.unwrap().status.as_deref(), Some("waiting for assistant"));
        // The listed user message does not print it again.
        let listed = message(json!({ "id": "msg_p", "type": "user", "text": "hi" }));
        assert!(transcript.message(&listed, true).commits.is_empty());
    }

    /// A turn that fails before its first step, or is interrupted by anything but this client's gesture, shows
    /// the terminal event's error once it settles; a step that showed its own error is not repeated.
    #[test]
    fn a_turn_shows_the_terminal_error_no_step_showed() {
        let failed = || {
            event(
                "session.execution.failed",
                json!({ "error": { "type": "unknown", "message": "API key is missing" } }),
            )
        };
        let interrupted = |reason: &str| event("session.execution.interrupted", json!({ "reason": reason }));
        let delivered = event("session.inbox.delivered", json!({ "inboxID": "msg_p" }));
        let mut transcript = Transcript::new("ses_1", true, true, true, None);
        transcript.hydrate(&[], false);
        let error = |commit: Option<Commit>| commit.map(|commit| (commit.kind, commit.text, commit.message_id));
        transcript.begin_wait("msg_p");
        transcript.admitted("msg_p", "hi", &[], &[]);
        transcript.event(&delivered);
        transcript.event(&failed());
        let listed = message(json!({ "id": "msg_p", "type": "user", "text": "hi" }));
        transcript.message(&listed, true);
        assert_eq!(
            error(transcript.end_wait()),
            Some((EntryKind::Error, "API key is missing".into(), Some("msg_p".into())))
        );
        transcript.begin_wait("msg_q");
        transcript.event(&interrupted("shutdown"));
        assert_eq!(error(transcript.end_wait()).map(|error| error.1), Some("Session interrupted: shutdown".into()));
        transcript.begin_wait("msg_r");
        transcript.interrupt_wait();
        transcript.event(&interrupted("user"));
        assert_eq!(error(transcript.end_wait()), None);
        transcript.begin_wait("msg_s");
        let step = event(
            "session.step.failed",
            json!({ "assistantMessageID": "msg_a", "error": { "type": "unknown", "message": "Boom" } }),
        );
        assert_eq!(texts(&transcript.event(&step)), [(EntryKind::Error, "Boom".into())]);
        transcript.event(&failed());
        assert_eq!(error(transcript.end_wait()), None);
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

    /// A prompt delivered before the list has it is restored as a local row; once listed, it does not print again.
    #[test]
    fn a_restored_prompt_prints_once_when_it_is_listed() {
        let mut transcript = Transcript::new("ses_1", true, true, true, None);
        transcript.hydrate(&[], true);
        transcript.admitted("msg_p", "hello", &[], &[]);
        let delivered = transcript.event(&event("session.inbox.delivered", json!({ "inboxID": "msg_p" })));
        assert_eq!(texts(&delivered), [(EntryKind::User, "hello".into())]);
        transcript.begin_replay();
        assert_eq!(texts(&transcript.replayed(&[], true)), [(EntryKind::User, "hello".into())]);
        let listed = message(json!({ "id": "msg_p", "type": "user", "text": "hello" }));
        assert_eq!(texts(&transcript.hydrate(&[listed], false)), []);
    }

    /// A user message names its skills above its text while tools show, once per skill (`renderUser`).
    #[test]
    fn a_user_message_shows_its_skills_with_tools() {
        let user = message(json!({ "id": "msg_u", "type": "user", "text": "tidy up",
            "skills": [{ "id": "tidy", "name": "tidy" }, { "id": "tidy", "name": "tidy" }] }));
        let mut shown = Transcript::new("ses_1", true, true, true, None);
        assert_eq!(
            texts(&shown.hydrate(std::slice::from_ref(&user), false)),
            [(EntryKind::System, "→ Skill \"tidy\"".into()), (EntryKind::User, "tidy up".into())]
        );
        let mut hidden = Transcript::new("ses_1", true, false, true, None);
        assert_eq!(texts(&hidden.hydrate(&[user], false)), [(EntryKind::User, "tidy up".into())]);
    }

    /// A local row whose text conflicts with the listed text of its message is not restored: the list shows the
    /// message (`performResizeReplay` falls through to its `messageIDs` check).
    #[test]
    fn a_resize_replay_drops_a_conflicting_row_of_a_listed_message() {
        let mut transcript = Transcript::new("ses_1", true, true, true, None);
        transcript.hydrate(&[], true);
        transcript.event(&delta("msg_a", "x"));
        transcript.begin_replay();
        let listed = [message(json!({ "id": "msg_a", "type": "assistant",
            "content": [{ "type": "text", "text": "yx" }] }))];
        assert_eq!(texts(&transcript.replayed(&listed, true)), [(EntryKind::Assistant, "yx".into())]);
    }

    /// A resize replay restores a local image row even when its message was listed (`performResizeReplay`).
    #[test]
    fn a_resize_replay_restores_an_image_of_a_listed_message() {
        let mut transcript = Transcript::new("ses_1", true, true, true, None);
        let listed = [message(json!({ "id": "msg_a", "type": "assistant", "content": [] }))];
        transcript.hydrate(&listed, true);
        let mut image =
            Commit::new(EntryKind::Tool, Source::Tool, Phase::Final, "shot").message("msg_a").part_id("prt_1:image:0");
        image.image = Some("data:image/png;base64,AA".into());
        transcript.remember(&image);
        transcript.begin_replay();
        assert_eq!(texts(&transcript.replayed(&listed, true)), [(EntryKind::Tool, "shot".into())]);
    }

    /// A compaction already running when the session is listed goes on to print the rest of its summary.
    #[test]
    fn a_listed_running_compaction_prints_its_tail() {
        let mut transcript = Transcript::new("ses_1", true, true, true, None);
        let running = message(json!({ "id": "msg_c", "type": "compaction", "status": "running", "reason": "auto",
            "summary": "Part one" }));
        assert_eq!(
            texts(&transcript.hydrate(&[running], true)),
            [(EntryKind::System, "Compaction".into()), (EntryKind::Assistant, "Part one".into())]
        );
        let ended = event("session.compaction.ended", json!({ "reason": "auto", "text": "Part one and two" }));
        assert_eq!(
            texts(&transcript.event(&ended)),
            [(EntryKind::Assistant, " and two".into()), (EntryKind::Assistant, "".into())]
        );
    }

    /// A streamed part is remembered as one local row holding its whole text, as each delta extends it.
    #[test]
    fn streamed_parts_are_remembered_whole() {
        let mut transcript = Transcript::new("ses_1", true, true, true, None);
        transcript.hydrate(&[], true);
        let reasoning = |text: &str| {
            event("session.reasoning.delta", json!({ "assistantMessageID": "msg_a", "ordinal": 0, "delta": text }))
        };
        for chunk in ["a", "b", "c"] {
            transcript.event(&reasoning(chunk));
            transcript.event(&delta("msg_a", chunk));
            transcript.event(&delta("msg_a", chunk));
        }
        let rows: Vec<_> = transcript.local.iter().map(|row| (row.kind, row.text.as_str())).collect();
        assert_eq!(
            rows,
            [
                (EntryKind::Reasoning, "Thinking: a"),
                (EntryKind::Assistant, "aa"),
                (EntryKind::Reasoning, "Thinking: ab"),
                (EntryKind::Assistant, "aabb"),
                (EntryKind::Reasoning, "Thinking: abc"),
                (EntryKind::Assistant, "aabbcc"),
            ]
        );
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
        assert_eq!(fragments.delta(&part, "d"), Some(3));
        assert_eq!(fragments.restore(&part, "ab"), Restore::Covered);
        assert_eq!(fragments.restore(&part, "abcdef"), Restore::Append("ef".into()));
        assert_eq!(fragments.restore(&part, "xyz"), Restore::Conflict);
        assert_eq!(fragments.end(&part, "final").previous, "abcdef");
    }

    /// The hydration model (M6): a server that makes prompts and streams answers, a stream that drops, reads that
    /// return in any order, and resizes. After every quiet point, the rows since the last clear show each listed
    /// message exactly once and whole. The harness drives [`Transcript`] as `Mini::incoming`, `Mini::resized` and
    /// `Mini::replay_on_resize` do.
    mod model {
        use super::*;
        use std::collections::VecDeque;

        /// SplitMix64.
        struct Rng(u64);

        impl Rng {
            fn next(&mut self) -> u64 {
                self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
                let mut z = self.0;
                z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
                z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
                z ^ (z >> 31)
            }

            fn below(&mut self, n: usize) -> usize {
                (self.next() % n as u64) as usize
            }
        }

        fn env(name: &str, default: u64) -> u64 {
            std::env::var(name).ok().and_then(|value| value.parse().ok()).unwrap_or(default)
        }

        #[derive(Clone, Copy, Debug)]
        enum Command {
            /// The server admits and delivers a prompt.
            User,
            /// The server starts an assistant message.
            Step,
            /// A text delta of the current assistant message.
            Delta,
            /// The current assistant message's text ends.
            End,
            /// The next event reaches the UI.
            Deliver,
            Resize,
            /// A read in flight returns, by index.
            Complete(usize),
            /// A resize read in flight fails, by index.
            Fail(usize),
            /// The stream drops: its queued events are lost, and the reconnect lists again.
            Drop,
            /// The scheduled replay fires.
            Timer,
        }

        fn command(rng: &mut Rng) -> Command {
            match rng.below(21) {
                20 => Command::Timer,
                0..=1 => Command::User,
                2 => Command::Step,
                3..=6 => Command::Delta,
                7 => Command::End,
                8..=12 => Command::Deliver,
                13..=14 => Command::Resize,
                15..=17 => Command::Complete(rng.below(4)),
                18 => Command::Fail(rng.below(4)),
                _ => Command::Drop,
            }
        }

        enum Read {
            Hydrate,
            Relist(u64),
        }

        /// A read the server answered when it was sent; the UI sees the answer when it completes.
        struct Pending {
            read: Read,
            listed: Vec<SessionMessageInfo>,
        }

        struct World {
            /// The server's messages: ID, whether a prompt, and text.
            messages: Vec<(String, bool, String)>,
            current: Option<usize>,
            stream: VecDeque<V2Event>,
            reads: Vec<Pending>,
            /// The stream's events wait behind a hydration in flight.
            hydrating: bool,
            transcript: Transcript,
            /// The rows since the last clear.
            screen: Vec<Commit>,
            resize_queued: bool,
            /// A replay is scheduled (`Mini::schedule_replay`).
            timer: bool,
            /// The relists an overflow started.
            overflows: usize,
            next: usize,
        }

        impl World {
            fn new() -> Self {
                let mut transcript = Transcript::new("ses_1", true, true, true, None);
                transcript.relist_limit = 2;
                let mut world = Self {
                    messages: Vec::new(),
                    current: None,
                    stream: VecDeque::new(),
                    reads: Vec::new(),
                    hydrating: true,
                    transcript,
                    screen: Vec::new(),
                    resize_queued: false,
                    timer: false,
                    overflows: 0,
                    next: 0,
                };
                world.issue(Read::Hydrate);
                world
            }

            fn id(&mut self) -> usize {
                self.next += 1;
                self.next
            }

            fn listed(&self) -> Vec<SessionMessageInfo> {
                self.messages
                    .iter()
                    .map(|(id, user, text)| match user {
                        true => message(json!({ "id": id, "type": "user", "text": text })),
                        false => message(json!({ "id": id, "type": "assistant",
                            "content": [{ "type": "text", "text": text }] })),
                    })
                    .collect()
            }

            fn issue(&mut self, read: Read) {
                let listed = self.listed();
                self.reads.push(Pending { read, listed });
            }

            /// `Mini::incoming`: the rows, then the read an overflow starts.
            fn show(&mut self, output: Output) {
                self.screen.extend(output.commits);
                if let Some(ticket) = output.relist {
                    self.overflows += 1;
                    self.issue(Read::Relist(ticket));
                }
            }

            fn run(&mut self, command: Command) {
                match command {
                    Command::User => {
                        let id = format!("msg_u{}", self.id());
                        let text = format!("u{}", self.next);
                        let item = json!({ "type": "user", "payload": { "text": text }, "delivery": "steer" });
                        self.stream.push_back(event("session.inbox.enqueued", json!({ "inboxID": id, "item": item })));
                        self.stream.push_back(event("session.inbox.delivered", json!({ "inboxID": id })));
                        self.messages.push((id, true, text));
                    }
                    Command::Step => {
                        let id = format!("msg_a{}", self.id());
                        self.messages.push((id, false, String::new()));
                        self.current = Some(self.messages.len() - 1);
                    }
                    Command::Delta => {
                        let Some(index) = self.current else { return };
                        let token = format!("[{}]", self.id());
                        let message = &mut self.messages[index];
                        message.2.push_str(&token);
                        self.stream.push_back(delta(&message.0, &token));
                    }
                    Command::End => {
                        let Some(index) = self.current.take() else { return };
                        let (id, _, text) = &self.messages[index];
                        let data = json!({ "assistantMessageID": id, "ordinal": 0, "text": text });
                        self.stream.push_back(event("session.text.ended", data));
                    }
                    Command::Deliver => {
                        if self.hydrating {
                            return;
                        }
                        let Some(event) = self.stream.pop_front() else { return };
                        let output = self.transcript.event(&event);
                        self.show(output);
                    }
                    Command::Resize => self.resize(),
                    Command::Complete(index) => self.complete(index, true),
                    Command::Fail(index) => self.complete(index, false),
                    // The connect loop notices a drop only once its hydration was posted.
                    Command::Timer => {
                        if std::mem::take(&mut self.timer) {
                            self.resize();
                        }
                    }
                    Command::Drop if self.hydrating => {}
                    Command::Drop => {
                        self.stream.clear();
                        self.transcript.disconnected();
                        self.hydrating = true;
                        self.issue(Read::Hydrate);
                    }
                }
            }

            /// `Mini::replay_on_resize`.
            fn resize(&mut self) {
                if !self.transcript.replay || !self.transcript.connected {
                    return;
                }
                if self.transcript.replaying() {
                    self.resize_queued = true;
                    return;
                }
                let ticket = self.transcript.begin_replay();
                self.issue(Read::Relist(ticket));
            }

            fn complete(&mut self, index: usize, ok: bool) {
                if self.reads.is_empty() {
                    return;
                }
                let index = index % self.reads.len();
                if !ok && matches!(self.reads[index].read, Read::Hydrate) {
                    return;
                }
                let pending = self.reads.remove(index);
                match pending.read {
                    Read::Hydrate => {
                        self.hydrating = false;
                        self.transcript.inbox(&[]);
                        let output = self.transcript.hydrate(&pending.listed, false);
                        self.show(output);
                        if std::mem::take(&mut self.resize_queued) || self.transcript.lost() {
                            self.resize();
                        }
                    }
                    Read::Relist(ticket) if !self.transcript.relisting(ticket) => {}
                    Read::Relist(_) => {
                        let output = match ok {
                            true => {
                                self.screen.clear();
                                self.transcript.inbox(&[]);
                                self.transcript.replayed(&pending.listed, false)
                            }
                            false => self.transcript.abort_replay(),
                        };
                        self.show(output);
                        if std::mem::take(&mut self.resize_queued) {
                            self.resize();
                        } else if self.transcript.lost() {
                            self.timer = true;
                        }
                    }
                }
            }

            fn quiet(&self) -> bool {
                self.reads.is_empty() && !self.hydrating && self.stream.is_empty() && !self.timer
            }

            fn drain(&mut self) {
                while !self.quiet() {
                    if !self.reads.is_empty() {
                        self.complete(0, true);
                    }
                    self.run(Command::Deliver);
                    self.run(Command::Timer);
                }
            }

            /// Every message shows once and whole since the last clear, and nothing else shows.
            fn check(&self) -> Result<(), String> {
                for (id, user, text) in &self.messages {
                    let rows: Vec<&Commit> =
                        self.screen.iter().filter(|row| row.message_id.as_deref() == Some(id.as_str())).collect();
                    let shown = match user {
                        true => rows.iter().filter(|row| row.kind == EntryKind::User).count().to_string(),
                        false => rows.iter().map(|row| row.text.as_str()).collect(),
                    };
                    let expected = if *user { "1".to_owned() } else { text.clone() };
                    if shown != expected {
                        return Err(format!("{id} shows {shown:?}, expected {expected:?}"));
                    }
                }
                let known = |row: &&Commit| self.messages.iter().any(|(id, _, _)| row.message_id.as_ref() == Some(id));
                if let Some(row) = self.screen.iter().find(|row| !known(row)) {
                    return Err(format!("unknown row {row:?}"));
                }
                Ok(())
            }
        }

        /// Runs `commands`, then drains; the relists an overflow started.
        fn play(commands: &[Command]) -> Result<usize, String> {
            let mut world = World::new();
            for (step, command) in commands.iter().enumerate() {
                world.run(*command);
                if world.quiet() {
                    world.check().map_err(|error| format!("after {step}: {error}"))?;
                }
            }
            world.drain();
            world.check().map(|()| world.overflows)
        }

        /// Removes one command at a time while the run still fails.
        fn shrink(mut commands: Vec<Command>) -> Vec<Command> {
            let mut index = 0;
            while index < commands.len() {
                let mut shorter = commands.clone();
                shorter.remove(index);
                if play(&shorter).is_err() {
                    commands = shorter;
                } else {
                    index += 1;
                }
            }
            commands
        }

        /// S4: a relist in flight when the stream drops must not clear the reconnect's rows and print its older list.
        #[test]
        fn a_drop_during_a_relist_keeps_the_reconnects_rows() {
            let commands = [Command::Complete(0), Command::Resize, Command::User, Command::Drop, Command::Complete(1)];
            assert_eq!(play(&commands), Ok(0));
        }

        /// S5: a relist holds at most its limit of events; one more drops them and starts a new read, and the
        /// older read no longer applies.
        #[test]
        fn an_overflow_relists() {
            let mut transcript = Transcript::new("ses_1", true, true, true, None);
            transcript.relist_limit = 2;
            transcript.hydrate(&[], true);
            let first = transcript.begin_replay();
            for text in ["a", "b"] {
                assert_eq!(transcript.event(&delta("msg_a", text)), Output::default());
            }
            let output = transcript.event(&delta("msg_a", "c"));
            let second = output.relist.expect("the overflow relists");
            assert!(!transcript.relisting(first) && transcript.relisting(second) && transcript.lost());
            assert_eq!(transcript.relist.as_ref().map(|relist| relist.events.len()), Some(0));
            let listed = [message(json!({ "id": "msg_a", "type": "assistant",
                "content": [{ "type": "text", "text": "abc" }] }))];
            assert_eq!(texts(&transcript.replayed(&listed, true)), [(EntryKind::Assistant, "abc".into())]);
            assert!(!transcript.lost());
        }

        #[test]
        fn every_quiet_screen_shows_the_listed_messages_once() {
            let seed = env("MODEL_SEED", 1);
            let cases = env("MODEL_CASES", 300);
            let len = env("MODEL_LEN", 40) as usize;
            let mut rng = Rng(seed);
            let mut overflows = 0;
            for case in 0..cases {
                let commands: Vec<Command> = (0..len).map(|_| command(&mut rng)).collect();
                match play(&commands) {
                    Ok(count) => overflows += count,
                    Err(error) => {
                        let shrunk = shrink(commands);
                        panic!("seed {seed} case {case}: {error}\nshrunk: {shrunk:?}\n{:?}", play(&shrunk));
                    }
                }
            }
            assert!(overflows >= cases as usize / 10, "the generator overflows the relist: {overflows}");
        }
    }
}
