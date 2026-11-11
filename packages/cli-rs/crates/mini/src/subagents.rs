//! Child sessions of the open session (`stream-v2.subagent.ts`).
//!
//! The tracker finds child sessions from four sources: the subagent tool calls of the listed messages
//! (`metadata.sessionID`), the session list filtered by parent, the running sessions, and live events of unknown
//! sessions whose parent is in the family. It keeps one tab per child, the permissions and forms each child waits
//! on, and a transcript of the selected child, rebuilt from its messages and then kept from live events.
//!
//! [`Tracker`] is a plain state machine. Reads it needs come back as [`Fetch`]es; the owner runs them and hands
//! the results to the matching method ([`Tracker::family`], [`Tracker::discovered`], [`Tracker::child_loaded`],
//! [`Tracker::blockers_loaded`]).

use std::collections::{HashMap, HashSet, VecDeque};
use std::time::Duration;

use indexmap::{IndexMap, IndexSet};
use opencode_api::generated::{
    FormInfo, PromptFileAttachment, SessionInboxInfo, SessionInboxItem, SessionInfo,
    SessionMessageAssistantContentItem as ContentItem, SessionMessageAssistantTool,
    SessionMessageAssistantToolState as ToolPartState, SessionMessageAssistantToolTime, SessionMessageInfo,
    SessionMessageToolStateCompleted, SessionMessageToolStateError, SessionMessageToolStateRunning,
    SessionMessageToolStateStreaming, V2Event,
};
use opencode_ui::tool_info::{canonical_tool_name, titlecase, tool_display_content, tool_output_text};
use serde_json::Value;

use crate::footers::permission::Request;
use crate::replay::{Fragment, Fragments, session_of, user_image_commits};
use crate::scrollback::{Commit, EntryKind, Phase, Source};

/// `CHILD_MESSAGE_LIMIT`: the messages a child's transcript lists.
pub const CHILD_MESSAGE_LIMIT: u32 = 80;
const FRAME_LIMIT: usize = 80;
const EVENT_BUFFER_LIMIT: usize = 64;
/// `FAMILY_LIST_LIMIT`: the most children tracked, and the depth of a lineage walk.
pub const FAMILY_LIMIT: usize = 100;
const DISCOVERY_CONCURRENCY: usize = 8;
const RETRY_INITIAL_MS: u64 = 50;
const RETRY_MAX_MS: u64 = 2_000;
const FALLBACK_LABEL: &str = "Subagent";

/// `FooterSubagentTab["status"]`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Running,
    Completed,
    Error,
    Cancelled,
}

/// `FooterSubagentTab`.
#[derive(Clone, Debug, PartialEq)]
pub struct Tab {
    pub session_id: String,
    pub label: String,
    pub description: String,
    pub status: Status,
    pub title: Option<String>,
}

/// A read the tracker needs.
#[derive(Clone, Debug, PartialEq)]
pub enum Fetch {
    /// The family index: the sessions under the parent, breadth first, up to [`FAMILY_LIMIT`].
    Family,
    /// Walks up from `session` while no ancestor is in `family`.
    Discover { session: String, family: HashSet<String> },
    /// The child's newest [`CHILD_MESSAGE_LIMIT`] messages and its inbox.
    Child(String),
    /// The child's permissions, with their tool calls, and forms, after `delay`.
    Blockers { session: String, epoch: u64, delay: Duration },
}

/// What a lineage walk found.
#[derive(Clone, Debug)]
pub enum Discovery {
    /// The sessions from the one asked for up to the first whose parent is in the family.
    Family(Vec<SessionInfo>),
    Unrelated,
    Failed,
}

#[derive(Clone, Debug, PartialEq)]
struct Prompt {
    text: String,
    files: Vec<PromptFileAttachment>,
}

#[derive(Debug)]
struct Child {
    session_id: String,
    label: String,
    description: String,
    status: Status,
    title: Option<String>,
    updated: f64,
    frames: Vec<(String, Commit)>,
    fragments: Fragments,
    tools: HashMap<String, SessionMessageAssistantTool>,
    tool_sources: HashMap<String, SessionMessageAssistantTool>,
    finished: HashSet<String>,
    permissions: Vec<Request>,
    forms: Vec<FormInfo>,
    message_ids: HashSet<String>,
    prompts: HashMap<String, Prompt>,
    hydrated: bool,
    stale: bool,
    blockers_hydrated: bool,
}

impl Child {
    fn new(session_id: &str) -> Self {
        Self {
            session_id: session_id.to_owned(),
            label: FALLBACK_LABEL.to_owned(),
            description: String::new(),
            status: Status::Running,
            title: None,
            updated: 0.0,
            frames: Vec::new(),
            fragments: Fragments::default(),
            tools: HashMap::new(),
            tool_sources: HashMap::new(),
            finished: HashSet::new(),
            permissions: Vec::new(),
            forms: Vec::new(),
            message_ids: HashSet::new(),
            prompts: HashMap::new(),
            hydrated: false,
            stale: false,
            blockers_hydrated: false,
        }
    }

    fn tab(&self) -> Tab {
        Tab {
            session_id: self.session_id.clone(),
            label: self.label.clone(),
            description: if self.description.is_empty() {
                self.title.clone().unwrap_or_default()
            } else {
                self.description.clone()
            },
            status: self.status,
            title: self.title.clone(),
        }
    }

    fn touch(&mut self, time: f64) {
        self.updated = self.updated.max(time);
    }

    fn set_frame(&mut self, key: String, commit: Commit) {
        if let Some(frame) = self.frames.iter_mut().find(|(item, _)| *item == key) {
            frame.1 = commit;
            return;
        }
        self.frames.push((key, commit));
        if self.frames.len() > FRAME_LIMIT {
            self.frames.drain(..self.frames.len() - FRAME_LIMIT);
        }
    }

    /// `applyMeta`: the subagent call's input names the agent and the task.
    fn apply_meta(&mut self, meta: Option<&IndexMap<String, Value>>) {
        let Some(meta) = meta else { return };
        if let Some(agent) = text(meta.get("agent")) {
            self.label = titlecase(agent);
        }
        if let Some(description) = text(meta.get("description")) {
            self.description = description.to_owned();
        }
    }

    /// `userFrame`: a delivered prompt, once.
    fn user_frame(&mut self, message: &str, prompt: &Prompt) -> bool {
        if !self.message_ids.insert(message.to_owned()) {
            return false;
        }
        if !prompt.text.trim().is_empty() {
            let commit =
                Commit::new(EntryKind::User, Source::System, Phase::Start, prompt.text.clone()).message(message);
            self.set_frame(format!("user:{message}"), commit);
        }
        for commit in user_image_commits(message, &prompt.files) {
            let key = source_key(message, commit.part_id.as_deref().unwrap_or_default());
            self.set_frame(key, commit);
        }
        true
    }

    /// `childTool`: one state of a tool part. A running part shows its start once and then its output; a finished
    /// part shows its end.
    fn tool(&mut self, part: SessionMessageAssistantTool, message: &str, directory: Option<&str>) {
        let key = source_key(message, &part.id);
        let frame = format!("tool:{key}");
        self.tool_sources.insert(key.clone(), part.clone());
        if matches!(part.state, ToolPartState::Streaming(_)) {
            self.tools.insert(key, part);
            return;
        }
        let name = canonical_tool_name(&part.name).to_owned();
        let output = tool_output_text(&name, &tool_display_content(&part.state));
        let commit = |phase, value: Option<&str>| crate::tools::commit(&part, message, phase, value, directory, 0);
        if let ToolPartState::Running(state) = &part.state {
            let provider =
                |state: &SessionMessageToolStateRunning| state.metadata.get("provider").is_some_and(Value::is_string);
            let ready = name != "websearch" || provider(state);
            let current = self.tools.get(&key);
            let awaiting = current.is_some_and(|current| {
                canonical_tool_name(&current.name) == "websearch"
                    && matches!(&current.state, ToolPartState::Running(state) if !provider(state))
            });
            let fresh = current.is_none_or(|current| matches!(current.state, ToolPartState::Streaming(_)));
            if ready && (fresh || awaiting) {
                self.set_frame(frame.clone(), commit(Phase::Start, None));
            }
            if !output.is_empty() {
                self.set_frame(frame, commit(Phase::Progress, Some(&output)));
            }
            self.tools.insert(key, part);
            return;
        }
        self.finished.insert(key.clone());
        self.tools.remove(&key);
        let partial = matches!(part.state, ToolPartState::Error(_)) && !output.is_empty();
        if partial {
            self.set_frame(frame.clone(), commit(Phase::Progress, Some(&output)));
        }
        let last = crate::tools::final_phase(&part);
        self.set_frame(if partial { format!("{frame}:final") } else { frame }, commit(last, None));
        for commit in crate::tools::image_commits(&part, message) {
            let key = source_key(message, commit.part_id.as_deref().unwrap_or_default());
            self.set_frame(key, commit);
        }
    }

    /// `rebuild`: the transcript from listed messages, oldest first.
    fn rebuild(&mut self, messages: &[SessionMessageInfo], thinking: bool, directory: Option<&str>) {
        self.frames.clear();
        self.fragments.clear();
        self.finished.clear();
        self.tool_sources.clear();
        self.message_ids.clear();
        for message in messages {
            let assistant = match message {
                SessionMessageInfo::User(user) => {
                    let id = user.id.as_str();
                    self.prompts.remove(id);
                    let prompt = Prompt { text: user.text.clone(), files: user.files.clone().unwrap_or_default() };
                    self.user_frame(id, &prompt);
                    continue;
                }
                SessionMessageInfo::Assistant(assistant) => assistant,
                _ => continue,
            };
            let id = assistant.id.as_str();
            self.message_ids.insert(id.to_owned());
            let (mut text_ordinal, mut reasoning_ordinal) = (0, 0);
            for item in &assistant.content {
                match item {
                    ContentItem::Text(part) => {
                        let fragment = Fragment::new(id, "text", text_ordinal);
                        text_ordinal += 1;
                        self.fragments.project(&fragment, &part.text, true);
                        self.set_frame(fragment_key(&fragment), text_commit(&fragment, part.text.clone()));
                    }
                    ContentItem::Reasoning(part) => {
                        let fragment = Fragment::new(id, "reasoning", reasoning_ordinal);
                        reasoning_ordinal += 1;
                        self.fragments.project(&fragment, &part.text, true);
                        if thinking {
                            self.set_frame(fragment_key(&fragment), reasoning_commit(&fragment, &part.text));
                        }
                    }
                    ContentItem::Tool(tool) => self.tool(tool.clone(), id, directory),
                    _ => {}
                }
            }
            if let Some(error) = &assistant.error {
                self.set_frame(format!("error:{id}"), Commit::error(error.message.clone()).message(id));
            }
        }
    }

    /// `permissionTool`: a request with the input and metadata of the tool call it came from, when the child's
    /// transcript holds it; otherwise it keeps what it had.
    fn resolve(&self, request: Request) -> Request {
        let tool = request
            .info
            .source
            .as_ref()
            .filter(|source| source.r#type == "tool")
            .and_then(|source| self.tool_sources.get(&source_key(&source.message_id, &source.id)));
        let (input, metadata) = match tool.map(|tool| &tool.state) {
            Some(ToolPartState::Running(state)) => (to_value(&state.input), to_value(&state.metadata)),
            Some(ToolPartState::Completed(state)) => (to_value(&state.input), to_value(&state.metadata)),
            Some(ToolPartState::Error(state)) => (to_value(&state.input), to_value(&state.metadata)),
            _ => return request,
        };
        Request { input, metadata, ..request }
    }
}

/// A hydration of a child in flight: the events that arrive meanwhile, and what the child held when it started.
struct Hydration {
    events: Vec<V2Event>,
    overflow: bool,
    prompts: HashMap<String, Prompt>,
    tools: HashMap<String, SessionMessageAssistantTool>,
}

/// `createSubagentTracker`.
pub struct Tracker {
    parent: String,
    thinking: bool,
    directory: Option<String>,
    children: IndexMap<String, Child>,
    /// Live subagent calls of the parent, with their input once called (`pendingCalls`).
    calls: HashMap<String, Option<IndexMap<String, Value>>>,
    /// Sessions found to be outside the family, oldest first (`checked`).
    checked: IndexSet<String>,
    /// Events of sessions whose discovery is in flight (`pendingEvents`).
    pending: HashMap<String, Vec<V2Event>>,
    discovering: HashSet<String>,
    queue: VecDeque<String>,
    hydrations: HashMap<String, Hydration>,
    /// Permission and form events of children whose blockers are being listed (`blockerEvents`).
    blockers: HashMap<String, Vec<V2Event>>,
    retries: HashMap<String, u32>,
    active: HashSet<String>,
    selected: Option<String>,
    epoch: u64,
    changed: bool,
    detail: bool,
}

impl Tracker {
    pub fn new(parent: &str, thinking: bool, directory: Option<String>) -> Self {
        Self {
            parent: parent.to_owned(),
            thinking,
            directory,
            children: IndexMap::new(),
            calls: HashMap::new(),
            checked: IndexSet::new(),
            pending: HashMap::new(),
            discovering: HashSet::new(),
            queue: VecDeque::new(),
            hydrations: HashMap::new(),
            blockers: HashMap::new(),
            retries: HashMap::new(),
            active: HashSet::new(),
            selected: None,
            epoch: 0,
            changed: false,
            detail: false,
        }
    }

    pub fn parent(&self) -> &str {
        &self.parent
    }

    /// Shows or hides the reasoning that arrives from now on, as `/settings` does for the main transcript. TS
    /// fixes it when the tracker starts (`parity/deviations/O89-mini-subagent-thinking.md`).
    pub fn set_thinking(&mut self, thinking: bool) {
        self.thinking = thinking;
    }

    /// Whether the tabs, permissions, or forms changed since the last call (`emit`).
    pub fn take_changed(&mut self) -> bool {
        std::mem::take(&mut self.changed)
    }

    /// Whether the selected child's transcript changed since the last call (`notifyDetail`).
    pub fn take_detail(&mut self) -> bool {
        std::mem::take(&mut self.detail)
    }

    /// The tabs: running first, then the most recently updated (`snapshot().tabs`).
    pub fn tabs(&self) -> Vec<Tab> {
        let mut children: Vec<&Child> = self.children.values().collect();
        children.sort_by(|a, b| {
            (b.status == Status::Running)
                .cmp(&(a.status == Status::Running))
                .then(b.updated.partial_cmp(&a.updated).unwrap_or(std::cmp::Ordering::Equal))
        });
        children.into_iter().map(Child::tab).collect()
    }

    /// The selected child's transcript, `None` while it is stale after a reconnect.
    pub fn detail(&self, session: &str) -> Option<Vec<Commit>> {
        let child = self.children.get(session).filter(|child| !child.stale)?;
        Some(child.frames.iter().map(|(_, commit)| commit.clone()).collect())
    }

    /// Every child's permissions, children in the order they were found.
    pub fn permissions(&self) -> Vec<Request> {
        self.children.values().flat_map(|child| child.permissions.iter().cloned()).collect()
    }

    pub fn forms(&self) -> Vec<FormInfo> {
        self.children.values().flat_map(|child| child.forms.iter().cloned()).collect()
    }

    /// `settleForm`.
    pub fn settle_form(&mut self, session: &str, form: &str) {
        if let Some(child) = self.children.get_mut(session) {
            child.forms.retain(|item| item.id.0 != form);
            self.changed = true;
        }
    }

    /// `select`: the child the inspector shows, hydrated if it is not yet.
    pub fn select(&mut self, session: Option<&str>) -> Vec<Fetch> {
        self.selected = session.map(str::to_owned);
        self.changed = true;
        self.detail = true;
        match session.and_then(|session| self.children.get(session)).filter(|child| !child.hydrated) {
            Some(child) => self.hydrate_child(&child.session_id.clone()),
            None => Vec::new(),
        }
    }

    /// `hydrate`: after the parent's messages were listed. Adopts the children its subagent calls name; the
    /// family index follows as [`Fetch::Family`].
    pub fn hydrate(&mut self, messages: &[SessionMessageInfo], active: &[String], reconnect: bool) -> Vec<Fetch> {
        self.epoch += 1;
        self.retries.clear();
        self.blockers.clear();
        self.active = active.iter().cloned().collect();
        if reconnect {
            for child in self.children.values_mut() {
                child.hydrated = false;
                child.stale = true;
            }
        }
        for message in messages {
            let SessionMessageInfo::Assistant(assistant) = message else { continue };
            for item in &assistant.content {
                if let ContentItem::Tool(tool) = item {
                    self.main_tool(tool);
                }
            }
        }
        vec![Fetch::Family]
    }

    /// The family index arrived: adopts its sessions, discovers the running ones, settles children that stopped,
    /// and lists every child's blockers.
    pub fn family(&mut self, sessions: Vec<SessionInfo>) -> Vec<Fetch> {
        for session in sessions {
            let id = session.id.0.clone();
            if id == self.parent {
                continue;
            }
            let Some(child) = self.admit(&id) else { break };
            if let Some(agent) = &session.agent
                && child.label == FALLBACK_LABEL
            {
                child.label = titlecase(&agent.0);
            }
            if child.title.is_none() {
                child.title = session.title.clone();
            }
            child.touch(session.time.updated);
        }
        let mut fetches = Vec::new();
        let active: Vec<String> = self.active.iter().cloned().collect();
        for session in active {
            fetches.extend(self.discover(&session));
        }
        for child in self.children.values_mut() {
            // A reconnect can miss a settled event; the running sessions say which children still run.
            if child.status == Status::Running && !self.active.contains(&child.session_id) {
                child.status = Status::Completed;
            }
            child.blockers_hydrated = false;
        }
        let ids: Vec<String> = self.children.keys().cloned().collect();
        for id in ids {
            fetches.extend(self.hydrate_blockers(&id));
        }
        if let Some(selected) = self.selected.clone().filter(|id| self.children.contains_key(id)) {
            fetches.extend(self.hydrate_child(&selected));
        }
        if !self.children.is_empty() {
            self.changed = true;
        }
        fetches
    }

    /// `main`: a tool event of the parent. A subagent call's metadata names the child it started.
    pub fn main(&mut self, event: &V2Event) -> Vec<Fetch> {
        let (message, id, metadata, created, success) = match event {
            V2Event::SessionToolInputStarted(started) => {
                if canonical_tool_name(&started.data.name) == "subagent" {
                    let key = source_key(started.data.assistant_message_id.as_str(), &started.data.id);
                    self.calls.insert(key, None);
                }
                return Vec::new();
            }
            V2Event::SessionToolCalled(called) => {
                let key = source_key(called.data.assistant_message_id.as_str(), &called.data.id);
                if let Some(call) = self.calls.get_mut(&key) {
                    *call = Some(called.data.input.clone());
                }
                return Vec::new();
            }
            V2Event::SessionToolProgress(progress) => {
                let data = &progress.data;
                (data.assistant_message_id.as_str(), &data.id, Some(&data.metadata), progress.created, None)
            }
            V2Event::SessionToolSuccess(success) => {
                let data = &success.data;
                (data.assistant_message_id.as_str(), &data.id, data.metadata.as_ref(), success.created, Some(true))
            }
            V2Event::SessionToolFailed(failed) => {
                let data = &failed.data;
                (data.assistant_message_id.as_str(), &data.id, data.metadata.as_ref(), failed.created, Some(false))
            }
            _ => return Vec::new(),
        };
        let key = source_key(message, id);
        let call = match success {
            Some(_) => self.calls.remove(&key).flatten(),
            None => self.calls.get(&key).cloned().flatten(),
        };
        let Some((session, running)) = child_session(metadata) else {
            return Vec::new();
        };
        let Some(child) = self.admit(&session) else {
            return Vec::new();
        };
        child.apply_meta(call.as_ref());
        if success == Some(true) && running {
            child.status = Status::Running;
        }
        if success == Some(true) && !running && child.status == Status::Running {
            child.status = Status::Completed;
        }
        child.touch(created);
        let (blockers, hydrated) = (child.blockers_hydrated, child.hydrated);
        self.changed = true;
        let mut fetches = Vec::new();
        if !blockers {
            fetches.extend(self.hydrate_blockers(&session));
        }
        if !hydrated {
            fetches.extend(self.hydrate_child(&session));
        }
        fetches
    }

    /// `foreign`: an event of another session. A child takes it; an unknown session is discovered, its events
    /// waiting meanwhile.
    pub fn foreign(&mut self, event: &V2Event) -> Vec<Fetch> {
        let Some(session) = session_of(event).map(str::to_owned) else {
            return Vec::new();
        };
        if session == self.parent {
            return Vec::new();
        }
        if self.children.contains_key(&session) {
            if blocker(event)
                && let Some(buffered) = self.blockers.get_mut(&session)
                && buffered.len() < EVENT_BUFFER_LIMIT
            {
                buffered.push(event.clone());
            }
            if let Some(hydration) = self.hydrations.get_mut(&session) {
                if hydration.events.len() < EVENT_BUFFER_LIMIT {
                    hydration.events.push(event.clone());
                } else {
                    hydration.overflow = true;
                }
            }
            self.reduce(&session, event);
            return Vec::new();
        }
        let fetches = self.discover(&session);
        if let Some(buffered) = self.pending.get_mut(&session)
            && buffered.len() < EVENT_BUFFER_LIMIT
        {
            buffered.push(event.clone());
        }
        fetches
    }

    /// A lineage walk ended (`runDiscovery`).
    pub fn discovered(&mut self, session: &str, discovery: Discovery) -> Vec<Fetch> {
        self.discovering.remove(session);
        let mut fetches = self.pump();
        match discovery {
            Discovery::Family(lineage) => {
                let buffered = self.pending.remove(session).unwrap_or_default();
                for item in lineage.iter().rev() {
                    let Some(child) = self.admit(&item.id.0) else { break };
                    if let Some(agent) = &item.agent {
                        child.label = titlecase(&agent.0);
                    }
                    child.title = item.title.clone();
                    child.touch(item.time.updated);
                }
                if !self.children.contains_key(session) {
                    return fetches;
                }
                fetches.extend(self.hydrate_blockers(session));
                if let Some(events) = self.blockers.get_mut(session) {
                    *events = buffered.iter().filter(|event| blocker(event)).cloned().collect();
                }
                for event in &buffered {
                    self.reduce(session, event);
                }
                self.changed = true;
                fetches.extend(self.hydrate_child(session));
            }
            Discovery::Unrelated => {
                self.pending.remove(session);
                self.checked.shift_remove(session);
                self.checked.insert(session.to_owned());
                if self.checked.len() > FAMILY_LIMIT {
                    self.checked.shift_remove_index(0);
                }
            }
            // A later event may discover it again.
            Discovery::Failed => {
                self.pending.remove(session);
            }
        }
        fetches
    }

    /// A child's messages, oldest first, and its inbox arrived (`hydrateChild`).
    pub fn child_loaded(
        &mut self,
        session: &str,
        result: Result<(Vec<SessionMessageInfo>, Vec<SessionInboxInfo>), String>,
    ) -> Vec<Fetch> {
        let Some(hydration) = self.hydrations.remove(session) else {
            return Vec::new();
        };
        let (thinking, directory, selected) = (self.thinking, self.directory.clone(), self.selected.clone());
        let Some(child) = self.children.get_mut(session) else {
            return Vec::new();
        };
        let Ok((messages, inbox)) = result else {
            return Vec::new();
        };
        if hydration.overflow {
            // Too many events arrived meanwhile to replay them; list again.
            child.hydrated = false;
            if selected.as_deref() == Some(session) {
                self.detail = true;
            }
            return self.hydrate_child(session);
        }
        for item in inbox {
            if let SessionInboxInfo::User(item) = item {
                child.prompts.insert(item.id.0.clone(), prompt(&item.payload.text, item.payload.files.as_deref()));
            }
        }
        for (id, prompt) in hydration.prompts {
            child.prompts.entry(id).or_insert(prompt);
        }
        child.rebuild(&messages, thinking, directory.as_deref());
        let permissions: Vec<Request> =
            std::mem::take(&mut child.permissions).into_iter().map(|request| child.resolve(request)).collect();
        child.permissions = permissions;
        for (id, tool) in hydration.tools {
            if !child.finished.contains(&id) && !child.tools.contains_key(&id) {
                child.tools.insert(id, tool);
            }
        }
        for event in &hydration.events {
            self.reduce(session, event);
        }
        if let Some(child) = self.children.get_mut(session) {
            child.hydrated = true;
            child.stale = false;
        }
        if selected.as_deref() == Some(session) {
            self.detail = true;
        }
        Vec::new()
    }

    /// A child's permissions and forms arrived (`hydrateBlockers`). A failed list retries with a growing delay.
    pub fn blockers_loaded(
        &mut self,
        session: &str,
        epoch: u64,
        permissions: Result<Vec<Request>, String>,
        forms: Result<Vec<FormInfo>, String>,
    ) -> Vec<Fetch> {
        if epoch != self.epoch || !self.children.contains_key(session) {
            return Vec::new();
        }
        let buffered = self.blockers.remove(session).unwrap_or_default();
        let ok = permissions.is_ok() && forms.is_ok();
        if let Ok(permissions) = permissions {
            let child = &mut self.children[session];
            let permissions: Vec<Request> = permissions.into_iter().map(|request| child.resolve(request)).collect();
            child.permissions = permissions;
            for event in buffered
                .iter()
                .filter(|event| matches!(event, V2Event::PermissionAsked(_) | V2Event::PermissionReplied(_)))
            {
                self.reduce(session, event);
            }
        }
        if let Ok(forms) = forms {
            self.children[session].forms = forms;
            for event in buffered.iter().filter(|event| {
                blocker(event) && !matches!(event, V2Event::PermissionAsked(_) | V2Event::PermissionReplied(_))
            }) {
                self.reduce(session, event);
            }
        }
        self.changed = true;
        self.children[session].blockers_hydrated = ok;
        if ok {
            self.retries.remove(session);
            return Vec::new();
        }
        let attempt = self.retries.get(session).copied().unwrap_or(0);
        self.retries.insert(session.to_owned(), attempt + 1);
        let delay = (RETRY_INITIAL_MS << attempt.min(30)).min(RETRY_MAX_MS);
        vec![Fetch::Blockers { session: session.to_owned(), epoch, delay: Duration::from_millis(delay) }]
    }

    /// A delayed [`Fetch::Blockers`] is due: whether it still should run (`scheduleBlockerRetry`).
    pub fn retry_due(&mut self, session: &str, epoch: u64) -> bool {
        let due = epoch == self.epoch
            && !self.blockers.contains_key(session)
            && self.children.get(session).is_some_and(|child| !child.blockers_hydrated);
        if due {
            self.blockers.insert(session.to_owned(), Vec::new());
        }
        due
    }

    fn admit(&mut self, session: &str) -> Option<&mut Child> {
        if !self.children.contains_key(session) {
            if self.children.len() >= FAMILY_LIMIT {
                return None;
            }
            self.children.insert(session.to_owned(), Child::new(session));
        }
        // Events that waited for this child's discovery came first; replaying them now keeps their order.
        if let Some(buffered) = self.pending.remove(session) {
            for event in &buffered {
                self.reduce(session, event);
            }
        }
        self.children.get_mut(session)
    }

    /// `mainTool`: a listed subagent call of the parent.
    fn main_tool(&mut self, tool: &SessionMessageAssistantTool) {
        if canonical_tool_name(&tool.name) != "subagent" {
            return;
        }
        let (input, metadata) = match &tool.state {
            ToolPartState::Running(state) => (&state.input, Some(&state.metadata)),
            ToolPartState::Completed(state) => (&state.input, state.metadata.as_ref()),
            ToolPartState::Error(state) => (&state.input, state.metadata.as_ref()),
            _ => return,
        };
        let Some((session, running)) = child_session(metadata) else { return };
        let alive = self.active.contains(&session);
        let Some(child) = self.admit(&session) else { return };
        child.apply_meta(Some(input));
        if child.status == Status::Running {
            child.status = if running && alive { Status::Running } else { Status::Completed };
        }
        child.touch(tool.time.completed.unwrap_or(tool.time.created));
    }

    fn discover(&mut self, session: &str) -> Vec<Fetch> {
        if self.children.len() >= FAMILY_LIMIT
            || session == self.parent
            || self.checked.contains(session)
            || self.children.contains_key(session)
            || self.discovering.contains(session)
            || self.queue.iter().any(|queued| queued == session)
        {
            return Vec::new();
        }
        self.pending.insert(session.to_owned(), Vec::new());
        self.queue.push_back(session.to_owned());
        self.pump()
    }

    /// Starts queued discoveries, at most [`DISCOVERY_CONCURRENCY`] at a time.
    fn pump(&mut self) -> Vec<Fetch> {
        let mut fetches = Vec::new();
        while self.discovering.len() < DISCOVERY_CONCURRENCY {
            let Some(session) = self.queue.pop_front() else { break };
            self.discovering.insert(session.clone());
            let family = std::iter::once(self.parent.clone()).chain(self.children.keys().cloned()).collect();
            fetches.push(Fetch::Discover { session, family });
        }
        fetches
    }

    fn hydrate_child(&mut self, session: &str) -> Vec<Fetch> {
        if self.hydrations.contains_key(session) {
            return Vec::new();
        }
        let Some(child) = self.children.get(session) else {
            return Vec::new();
        };
        let hydration = Hydration {
            events: Vec::new(),
            overflow: false,
            prompts: child.prompts.clone(),
            tools: child.tools.clone(),
        };
        self.hydrations.insert(session.to_owned(), hydration);
        vec![Fetch::Child(session.to_owned())]
    }

    fn hydrate_blockers(&mut self, session: &str) -> Vec<Fetch> {
        let pending = self.children.get(session).is_none_or(|child| child.blockers_hydrated);
        if pending || self.blockers.contains_key(session) {
            return Vec::new();
        }
        self.blockers.insert(session.to_owned(), Vec::new());
        vec![Fetch::Blockers { session: session.to_owned(), epoch: self.epoch, delay: Duration::ZERO }]
    }

    /// `reduce`: one live event of a child.
    fn reduce(&mut self, session: &str, event: &V2Event) {
        let (thinking, directory) = (self.thinking, self.directory.clone());
        let directory = directory.as_deref();
        let selected = self.selected.as_deref() == Some(session);
        let Some(child) = self.children.get_mut(session) else { return };
        let mut detail = false;
        let mut changed = false;
        match event {
            V2Event::SessionInboxEnqueued(enqueued) => {
                if let SessionInboxItem::User(item) = &enqueued.data.item {
                    let prompt = prompt(&item.payload.text, item.payload.files.as_deref());
                    child.prompts.insert(enqueued.data.inbox_id.0.clone(), prompt);
                }
            }
            V2Event::SessionInboxDelivered(delivered) => {
                let id = delivered.data.inbox_id.as_str();
                if let Some(prompt) = child.prompts.remove(id)
                    && child.user_frame(id, &prompt)
                {
                    child.touch(delivered.created);
                    detail = true;
                }
            }
            V2Event::SessionInboxCancelled(cancelled) => {
                child.prompts.remove(cancelled.data.inbox_id.as_str());
            }
            V2Event::SessionStepStarted(started) => {
                child.touch(started.created);
                if child.label == FALLBACK_LABEL && !started.data.agent.0.is_empty() {
                    child.label = titlecase(&started.data.agent.0);
                }
                child.status = Status::Running;
                changed = true;
            }
            V2Event::SessionTextDelta(delta) => {
                let data = &delta.data;
                let fragment = Fragment::new(data.assistant_message_id.as_str(), "text", data.ordinal as u64);
                if child.fragments.delta(&fragment, &data.delta).is_some() {
                    let text = child.fragments.value(&fragment).unwrap_or_default().to_owned();
                    child.set_frame(fragment_key(&fragment), text_commit(&fragment, text));
                    child.touch(delta.created);
                    detail = true;
                }
            }
            V2Event::SessionTextEnded(ended) => {
                let data = &ended.data;
                let fragment = Fragment::new(data.assistant_message_id.as_str(), "text", data.ordinal as u64);
                child.fragments.end(&fragment, &data.text);
                child.set_frame(fragment_key(&fragment), text_commit(&fragment, data.text.clone()));
                child.touch(ended.created);
                detail = true;
            }
            V2Event::SessionReasoningDelta(delta) => {
                let data = &delta.data;
                let fragment = Fragment::new(data.assistant_message_id.as_str(), "reasoning", data.ordinal as u64);
                if child.fragments.delta(&fragment, &data.delta).is_some() && thinking {
                    let text = child.fragments.value(&fragment).unwrap_or_default().to_owned();
                    child.set_frame(fragment_key(&fragment), reasoning_commit(&fragment, &text));
                    detail = true;
                }
            }
            V2Event::SessionReasoningEnded(ended) => {
                let data = &ended.data;
                let fragment = Fragment::new(data.assistant_message_id.as_str(), "reasoning", data.ordinal as u64);
                child.fragments.end(&fragment, &data.text);
                if thinking {
                    child.set_frame(fragment_key(&fragment), reasoning_commit(&fragment, &data.text));
                    detail = true;
                }
            }
            V2Event::SessionToolInputStarted(started) => {
                let data = &started.data;
                let message = data.assistant_message_id.as_str();
                if !child.finished.contains(&source_key(message, &data.id)) {
                    let state = ToolPartState::Streaming(SessionMessageToolStateStreaming {
                        status: "streaming".into(),
                        input: String::new(),
                    });
                    let part = tool_part(&data.id, data.name.clone(), state, time(started.created, None, None));
                    child.tool(part, message, directory);
                }
            }
            V2Event::SessionToolInputDelta(_) | V2Event::SessionToolInputEnded(_) => {
                let (message, id, text) = match event {
                    V2Event::SessionToolInputDelta(delta) => {
                        (delta.data.assistant_message_id.as_str(), &delta.data.id, Err(delta.data.delta.as_str()))
                    }
                    V2Event::SessionToolInputEnded(ended) => {
                        (ended.data.assistant_message_id.as_str(), &ended.data.id, Ok(ended.data.text.as_str()))
                    }
                    _ => return,
                };
                if let Some(mut part) = child.tools.get(&source_key(message, id)).cloned()
                    && let ToolPartState::Streaming(state) = &mut part.state
                {
                    match text {
                        Ok(text) => state.input = text.to_owned(),
                        Err(delta) => state.input.push_str(delta),
                    }
                    child.tool(part, message, directory);
                }
            }
            V2Event::SessionToolCalled(called) => {
                let data = &called.data;
                let message = data.assistant_message_id.as_str();
                let key = source_key(message, &data.id);
                if !child.finished.contains(&key) {
                    let current = child.tools.get(&key);
                    let name = current.map_or_else(|| "tool".to_owned(), |part| part.name.clone());
                    let created = current.map_or(called.created, |part| part.time.created);
                    let state = ToolPartState::Running(SessionMessageToolStateRunning {
                        status: "running".into(),
                        input: data.input.clone(),
                        metadata: IndexMap::new(),
                    });
                    let mut part = tool_part(&data.id, name, state, time(created, Some(called.created), None));
                    part.executed = Some(data.executed);
                    part.native = data.native.clone();
                    child.tool(part, message, directory);
                    child.touch(called.created);
                    detail = true;
                }
            }
            V2Event::SessionToolProgress(progress) => {
                let data = &progress.data;
                let message = data.assistant_message_id.as_str();
                let key = source_key(message, &data.id);
                if !child.finished.contains(&key) {
                    let current = child.tools.get(&key).cloned();
                    let state = ToolPartState::Running(SessionMessageToolStateRunning {
                        status: "running".into(),
                        input: input_of(current.as_ref()),
                        metadata: data.metadata.clone(),
                    });
                    let name = current.as_ref().map_or_else(|| "tool".to_owned(), |part| part.name.clone());
                    let created = current.as_ref().map_or(progress.created, |part| part.time.created);
                    let ran = current.as_ref().and_then(|part| part.time.ran).unwrap_or(progress.created);
                    let mut part = tool_part(&data.id, name, state, time(created, Some(ran), None));
                    part.executed = current.as_ref().and_then(|part| part.executed);
                    part.native = current.as_ref().and_then(|part| part.native.clone());
                    child.tool(part, message, directory);
                    child.touch(progress.created);
                    detail = true;
                }
            }
            V2Event::SessionToolSuccess(_) | V2Event::SessionToolFailed(_) => {
                let (message, id, created, executed, native) = match event {
                    V2Event::SessionToolSuccess(success) => {
                        let data = &success.data;
                        (data.assistant_message_id.as_str(), &data.id, success.created, data.executed, &data.native)
                    }
                    V2Event::SessionToolFailed(failed) => {
                        let data = &failed.data;
                        (data.assistant_message_id.as_str(), &data.id, failed.created, data.executed, &data.native)
                    }
                    _ => return,
                };
                let key = source_key(message, id);
                if !child.finished.contains(&key) {
                    let current = child.tools.get(&key).cloned();
                    let input = input_of(current.as_ref());
                    let state = match event {
                        V2Event::SessionToolFailed(failed) => ToolPartState::Error(SessionMessageToolStateError {
                            status: "error".into(),
                            input,
                            error: failed.data.error.clone(),
                            content: failed.data.content.clone(),
                            metadata: failed.data.metadata.clone(),
                        }),
                        V2Event::SessionToolSuccess(success) => {
                            ToolPartState::Completed(SessionMessageToolStateCompleted {
                                status: "completed".into(),
                                input,
                                content: success.data.content.clone(),
                                metadata: success.data.metadata.clone(),
                            })
                        }
                        _ => return,
                    };
                    let previous = current.as_ref().and_then(|part| part.native.clone());
                    let native = match native {
                        Some(native) => {
                            let mut merged = previous.unwrap_or_default();
                            merged.extend(native.iter().map(|(key, value)| (key.clone(), value.clone())));
                            Some(merged)
                        }
                        None => previous,
                    };
                    let name = current.as_ref().map_or_else(|| "tool".to_owned(), |part| part.name.clone());
                    let started = current.as_ref().map_or(created, |part| part.time.created);
                    let ran = current.as_ref().and_then(|part| part.time.ran);
                    let mut part = tool_part(id, name, state, time(started, ran, Some(created)));
                    part.executed = Some(executed);
                    part.native = native;
                    child.tool(part, message, directory);
                    child.touch(created);
                    detail = true;
                }
            }
            V2Event::PermissionAsked(asked) => {
                if !child.permissions.iter().any(|item| item.info.id == asked.data.id) {
                    let info = crate::footers::asked(&asked.data);
                    let request = child.resolve(Request { info, input: Value::Null, metadata: Value::Null });
                    child.permissions.push(request);
                }
                changed = true;
            }
            V2Event::PermissionReplied(replied) => {
                child.permissions.retain(|item| item.info.id != replied.data.request_id);
                changed = true;
            }
            V2Event::FormCreated(created) => {
                if !child.forms.iter().any(|item| item.id == created.data.form.id) {
                    child.forms.push(created.data.form.clone());
                }
                changed = true;
            }
            V2Event::FormReplied(replied) => {
                child.forms.retain(|item| item.id != replied.data.id);
                changed = true;
            }
            V2Event::FormCancelled(cancelled) => {
                child.forms.retain(|item| item.id != cancelled.data.id);
                changed = true;
            }
            V2Event::SessionStepFailed(failed) => {
                let message = failed.data.assistant_message_id.as_str();
                child.set_frame(
                    format!("error:{message}"),
                    Commit::error(failed.data.error.message.clone()).message(message),
                );
                child.touch(failed.created);
                detail = true;
            }
            V2Event::SessionExecutionStarted(started) => {
                child.status = Status::Running;
                child.touch(started.created);
                changed = true;
            }
            V2Event::SessionExecutionSucceeded(done) => {
                child.status = Status::Completed;
                child.touch(done.created);
                changed = true;
            }
            V2Event::SessionExecutionFailed(done) => {
                child.status = Status::Error;
                child.touch(done.created);
                changed = true;
            }
            V2Event::SessionExecutionInterrupted(done) => {
                child.status = Status::Cancelled;
                child.touch(done.created);
                changed = true;
            }
            _ => {}
        }
        self.changed |= changed;
        self.detail |= detail && selected;
    }
}

/// `childSessionID`: the child a subagent call's metadata names, and whether it still runs.
fn child_session(metadata: Option<&IndexMap<String, Value>>) -> Option<(String, bool)> {
    let metadata = metadata?;
    let session = text(metadata.get("sessionID")).filter(|session| session.starts_with("ses"))?;
    match metadata.get("status").and_then(Value::as_str) {
        Some("running") => Some((session.to_owned(), true)),
        Some("completed") => Some((session.to_owned(), false)),
        _ => None,
    }
}

fn text(value: Option<&Value>) -> Option<&str> {
    value.and_then(Value::as_str).map(str::trim).filter(|text| !text.is_empty())
}

fn blocker(event: &V2Event) -> bool {
    matches!(
        event,
        V2Event::PermissionAsked(_)
            | V2Event::PermissionReplied(_)
            | V2Event::FormCreated(_)
            | V2Event::FormReplied(_)
            | V2Event::FormCancelled(_)
    )
}

fn source_key(message: &str, id: &str) -> String {
    format!("{message}\u{0}{id}")
}

fn fragment_key(fragment: &Fragment) -> String {
    source_key(&fragment.message_id, &fragment.part_id)
}

fn prompt(text: &str, files: Option<&[PromptFileAttachment]>) -> Prompt {
    Prompt { text: text.to_owned(), files: files.unwrap_or_default().to_vec() }
}

fn text_commit(fragment: &Fragment, text: String) -> Commit {
    Commit::new(EntryKind::Assistant, Source::Assistant, Phase::Progress, text)
        .message(&fragment.message_id)
        .part_id(&fragment.part_id)
}

fn reasoning_commit(fragment: &Fragment, text: &str) -> Commit {
    Commit::new(EntryKind::Reasoning, Source::Reasoning, Phase::Progress, format!("Thinking: {text}"))
        .message(&fragment.message_id)
        .part_id(&fragment.part_id)
}

fn to_value(value: &impl serde::Serialize) -> Value {
    serde_json::to_value(value).unwrap_or(Value::Null)
}

fn input_of(part: Option<&SessionMessageAssistantTool>) -> IndexMap<String, Value> {
    match part.map(|part| &part.state) {
        Some(ToolPartState::Running(state)) => state.input.clone(),
        Some(ToolPartState::Completed(state)) => state.input.clone(),
        Some(ToolPartState::Error(state)) => state.input.clone(),
        _ => IndexMap::new(),
    }
}

fn tool_part(
    id: &str,
    name: String,
    state: ToolPartState,
    time: SessionMessageAssistantToolTime,
) -> SessionMessageAssistantTool {
    SessionMessageAssistantTool {
        r#type: "tool".into(),
        id: id.to_owned(),
        name,
        executed: None,
        native: None,
        state,
        time,
    }
}

fn time(created: f64, ran: Option<f64>, completed: Option<f64>) -> SessionMessageAssistantToolTime {
    SessionMessageAssistantToolTime { created, ran, completed }
}

#[cfg(test)]
mod tests {
    use super::*;
    use opencode_api::generated::PermissionRequest;
    use serde::Deserialize;
    use serde_json::json;

    fn event(kind: &str, session: &str, data: Value) -> V2Event {
        let mut data = data;
        data["sessionID"] = json!(session);
        let event = json!({ "id": "evt_1", "created": 5, "type": kind,
            "durable": { "aggregateID": session, "seq": 1, "version": 1 }, "data": data });
        V2Event::deserialize(&event).unwrap()
    }

    fn assistant(id: &str, content: Value) -> SessionMessageInfo {
        let value = json!({ "id": id, "type": "assistant", "time": { "created": 1 }, "agent": "build",
            "model": { "id": "model", "providerID": "demo" }, "content": content });
        SessionMessageInfo::deserialize(&value).unwrap()
    }

    fn session(id: &str, parent: &str, agent: &str, updated: f64) -> SessionInfo {
        SessionInfo::deserialize(&json!({ "id": id, "parentID": parent, "projectID": "proj", "agent": agent,
            "title": format!("{agent} session"), "cost": 0,
            "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
            "time": { "created": 1, "updated": updated }, "location": { "directory": "/tmp" } }))
        .unwrap()
    }

    /// A subagent call of `ses_root` that started `child`.
    fn subagent_call(id: &str, child: &str, status: &str) -> Value {
        json!({ "type": "tool", "id": id, "name": "subagent", "time": { "created": 2, "completed": 3 },
            "state": { "status": "completed", "input": { "agent": "explore", "description": "Find the tests" },
                "content": [], "metadata": { "sessionID": child, "status": status } } })
    }

    fn texts(tracker: &Tracker, session: &str) -> Vec<(EntryKind, String)> {
        tracker.detail(session).unwrap().iter().map(|commit| (commit.kind, commit.text.clone())).collect()
    }

    #[test]
    fn live_subagent_calls_adopt_their_child() {
        let mut tracker = Tracker::new("ses_root", false, None);
        let call = |kind, data: Value| {
            let mut data = data;
            data["assistantMessageID"] = json!("msg_1");
            data["id"] = json!("call_1");
            event(kind, "ses_root", data)
        };
        assert!(tracker.main(&call("session.tool.input.started", json!({ "name": "subagent" }))).is_empty());
        let input = json!({ "agent": "general", "description": "Read the docs" });
        assert!(tracker.main(&call("session.tool.called", json!({ "input": input, "executed": false }))).is_empty());
        let metadata = json!({ "sessionID": "ses_child", "status": "running" });
        let fetches = tracker.main(&call("session.tool.progress", json!({ "metadata": metadata })));
        assert_eq!(
            fetches,
            [
                Fetch::Blockers { session: "ses_child".into(), epoch: 0, delay: Duration::ZERO },
                Fetch::Child("ses_child".into()),
            ]
        );
        assert!(tracker.take_changed());
        let tab = &tracker.tabs()[0];
        assert_eq!((tab.label.as_str(), tab.description.as_str()), ("General", "Read the docs"));
        assert_eq!(tab.status, Status::Running);
        // A metadata without a child session names nothing.
        let other = json!({ "assistantMessageID": "msg_1", "id": "call_2", "metadata": { "status": "running" } });
        assert!(tracker.main(&event("session.tool.progress", "ses_root", other)).is_empty());
        assert_eq!(tracker.tabs().len(), 1);
    }

    #[test]
    fn hydration_adopts_listed_calls_and_the_family() {
        let mut tracker = Tracker::new("ses_root", false, None);
        let messages = [assistant(
            "msg_1",
            json!([subagent_call("call_1", "ses_a", "completed"), subagent_call("call_2", "ses_b", "running")]),
        )];
        assert_eq!(tracker.hydrate(&messages, &["ses_b".into(), "ses_c".into()], false), [Fetch::Family]);
        let tabs = tracker.tabs();
        assert_eq!(tabs.len(), 2);
        // `ses_b` still runs; `ses_a` finished.
        assert_eq!((tabs[0].session_id.as_str(), tabs[0].status), ("ses_b", Status::Running));
        assert_eq!((tabs[1].session_id.as_str(), tabs[1].status), ("ses_a", Status::Completed));
        let fetches = tracker.family(vec![session("ses_d", "ses_root", "plan", 9.0)]);
        assert!(fetches.iter().any(|fetch| matches!(fetch, Fetch::Discover { session, .. } if session == "ses_c")));
        let blockers = fetches.iter().filter(|fetch| matches!(fetch, Fetch::Blockers { .. })).count();
        assert_eq!(blockers, 3);
        let tab = tracker.tabs().into_iter().find(|tab| tab.session_id == "ses_d").unwrap();
        // The family index's sessions are not running: they settle at once.
        assert_eq!(
            (tab.label.as_str(), tab.description.as_str(), tab.status),
            ("Plan", "plan session", Status::Completed)
        );
    }

    #[test]
    fn discovery_buffers_events_and_replays_them_in_order() {
        let mut tracker = Tracker::new("ses_root", true, None);
        tracker.hydrate(&[], &[], false);
        let delta = |text: &str| {
            event(
                "session.text.delta",
                "ses_new",
                json!({ "assistantMessageID": "msg_c", "ordinal": 0, "delta": text }),
            )
        };
        let fetches = tracker.foreign(&event("session.execution.started", "ses_new", json!({})));
        assert!(
            matches!(&fetches[..], [Fetch::Discover { session, family }] if session == "ses_new" && family.contains("ses_root"))
        );
        assert!(tracker.foreign(&delta("Hello ")).is_empty());
        assert!(tracker.tabs().is_empty());
        let fetches =
            tracker.discovered("ses_new", Discovery::Family(vec![session("ses_new", "ses_root", "explore", 4.0)]));
        assert!(fetches.contains(&Fetch::Child("ses_new".into())));
        tracker.foreign(&delta("world"));
        tracker.select(Some("ses_new"));
        assert_eq!(texts(&tracker, "ses_new"), [(EntryKind::Assistant, "Hello world".into())]);
        tracker.foreign(&event("session.execution.succeeded", "ses_new", json!({})));
        assert_eq!(tracker.tabs()[0].status, Status::Completed);
        // A session outside the family is remembered and not discovered again.
        tracker.foreign(&event("session.execution.started", "ses_far", json!({})));
        tracker.discovered("ses_far", Discovery::Unrelated);
        assert!(tracker.foreign(&event("session.execution.started", "ses_far", json!({}))).is_empty());
    }

    #[test]
    fn child_reasoning_follows_the_setting() {
        let mut tracker = Tracker::new("ses_root", true, None);
        tracker.hydrate(&[assistant("msg_p", json!([subagent_call("call_1", "ses_a", "running")]))], &[], false);
        tracker.select(Some("ses_a"));
        tracker.child_loaded("ses_a", Ok((Vec::new(), Vec::new())));
        let reasoning = |ordinal: u64, text: &str| {
            let data = json!({ "assistantMessageID": "msg_c", "ordinal": ordinal, "text": text });
            event("session.reasoning.ended", "ses_a", data)
        };
        tracker.set_thinking(false);
        tracker.foreign(&reasoning(0, "Hidden"));
        assert_eq!(texts(&tracker, "ses_a"), []);
        tracker.set_thinking(true);
        tracker.foreign(&reasoning(1, "Shown"));
        assert_eq!(texts(&tracker, "ses_a"), [(EntryKind::Reasoning, "Thinking: Shown".into())]);
    }

    #[test]
    fn a_child_transcript_rebuilds_then_follows_live_events() {
        let mut tracker = Tracker::new("ses_root", true, None);
        let messages = [assistant("msg_p", json!([subagent_call("call_1", "ses_a", "running")]))];
        tracker.hydrate(&messages, &["ses_a".into()], false);
        let fetches = tracker.select(Some("ses_a"));
        assert_eq!(fetches, [Fetch::Child("ses_a".into())]);
        // Events during the list wait and replay after it; the listed text is not repeated.
        let ended = json!({ "assistantMessageID": "msg_c", "ordinal": 0, "text": "Found three tests." });
        tracker.foreign(&event("session.text.ended", "ses_a", ended));
        let user = SessionMessageInfo::deserialize(&json!({ "id": "msg_u", "type": "user", "text": "Find the tests",
            "time": { "created": 1 } }))
        .unwrap();
        let listed = assistant(
            "msg_c",
            json!([
                { "type": "reasoning", "text": "Looking" },
                { "type": "text", "text": "Found three" },
            ]),
        );
        tracker.child_loaded("ses_a", Ok((vec![user, listed], Vec::new())));
        assert!(tracker.take_detail());
        assert_eq!(
            texts(&tracker, "ses_a"),
            [
                (EntryKind::User, "Find the tests".into()),
                (EntryKind::Reasoning, "Thinking: Looking".into()),
                (EntryKind::Assistant, "Found three tests.".into()),
            ]
        );
        let failed = json!({ "assistantMessageID": "msg_c", "error": { "type": "provider", "message": "Boom" } });
        tracker.foreign(&event("session.step.failed", "ses_a", failed));
        assert_eq!(texts(&tracker, "ses_a").last(), Some(&(EntryKind::Error, "Boom".into())));
    }

    #[test]
    fn child_requests_follow_lists_and_events() {
        let mut tracker = Tracker::new("ses_root", false, None);
        let messages = [assistant("msg_p", json!([subagent_call("call_1", "ses_a", "running")]))];
        tracker.hydrate(&messages, &["ses_a".into()], false);
        let fetches = tracker.family(Vec::new());
        assert!(fetches.contains(&Fetch::Blockers { session: "ses_a".into(), epoch: 1, delay: Duration::ZERO }));
        let permission = |id: &str| {
            let info = PermissionRequest::deserialize(&json!({ "id": id, "sessionID": "ses_a", "action": "read",
                "resources": ["a.txt"] }))
            .unwrap();
            Request { info, input: json!({ "filePath": "a.txt" }), metadata: Value::Null }
        };
        // An event that arrives while the list is in flight applies after it.
        let asked = json!({ "id": "per_2", "action": "edit", "resources": ["b.txt"] });
        tracker.foreign(&event("permission.asked", "ses_a", asked));
        let retry = tracker.blockers_loaded("ses_a", 1, Ok(vec![permission("per_1")]), Err("down".into()));
        assert_eq!(retry, [Fetch::Blockers { session: "ses_a".into(), epoch: 1, delay: Duration::from_millis(50) }]);
        let ids: Vec<String> = tracker.permissions().iter().map(|request| request.info.id.0.clone()).collect();
        assert_eq!(ids, ["per_1", "per_2"]);
        // The input read from the source message stays.
        assert_eq!(tracker.permissions()[0].input, json!({ "filePath": "a.txt" }));
        assert!(tracker.retry_due("ses_a", 1));
        let form = json!({ "id": "frm_1", "sessionID": "ses_a", "title": "Pick", "fields": [] });
        let forms = vec![FormInfo::deserialize(&form).unwrap()];
        assert!(tracker.blockers_loaded("ses_a", 1, Ok(vec![permission("per_1")]), Ok(forms)).is_empty());
        assert_eq!(tracker.forms().len(), 1);
        tracker.foreign(&event("permission.replied", "ses_a", json!({ "requestID": "per_1", "reply": "once" })));
        assert!(tracker.permissions().is_empty());
        tracker.settle_form("ses_a", "frm_1");
        assert!(tracker.forms().is_empty());
        // A list from an earlier hydration is ignored.
        assert!(tracker.blockers_loaded("ses_a", 0, Ok(vec![permission("per_9")]), Ok(Vec::new())).is_empty());
        assert!(tracker.permissions().is_empty());
    }

    #[test]
    fn tool_events_of_a_child_print_like_the_transcript() {
        let mut tracker = Tracker::new("ses_root", false, None);
        tracker.hydrate(
            &[assistant("msg_p", json!([subagent_call("call_1", "ses_a", "running")]))],
            &["ses_a".into()],
            false,
        );
        tracker.select(Some("ses_a"));
        tracker.child_loaded("ses_a", Ok((Vec::new(), Vec::new())));
        let data = |extra: Value| {
            let mut data = json!({ "assistantMessageID": "msg_c", "id": "call_r" });
            data.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            data
        };
        tracker.foreign(&event("session.tool.input.started", "ses_a", data(json!({ "name": "read" }))));
        let called = data(json!({ "input": { "filePath": "/tmp/a.txt" }, "executed": true }));
        tracker.foreign(&event("session.tool.called", "ses_a", called));
        let success = data(json!({ "content": [{ "type": "text", "text": "hello" }], "executed": true }));
        tracker.foreign(&event("session.tool.success", "ses_a", success));
        let commits = tracker.detail("ses_a").unwrap();
        assert_eq!(commits.len(), 1);
        assert_eq!((commits[0].kind, commits[0].tool.as_deref()), (EntryKind::Tool, Some("read")));
        assert_eq!(commits[0].tool_state, Some(crate::scrollback::ToolState::Completed));
        // A finished call ignores late events.
        tracker.foreign(&event("session.tool.progress", "ses_a", data(json!({ "metadata": {} }))));
        assert_eq!(tracker.detail("ses_a").unwrap().len(), 1);
    }
}
