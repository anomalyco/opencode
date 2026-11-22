use std::collections::{HashMap, HashSet};
use std::ops::{Index, IndexMut};

use futures_util::FutureExt;
use indexmap::IndexMap;
use opencode_api::generated::*;

use crate::changes::Touched;
use crate::connection::Follow;
use crate::forms::Form;
use crate::inbox::{PendingUpdate, now};
use crate::messages::{HeadRead, Transcript, from_event};
use crate::reads::{Read, ReadState, SessionRead, SessionReads};
use crate::state::{Compacting, Data, Error, Overlay, SessionStatus, State, Task, evict_missing};

/// Children per page of a family read (`CHILD_PAGE`).
const CHILD_PAGE: i64 = 200;

/// The fewest slots at which [`Sessions::sweep`] looks for records that hold nothing.
const SWEEP_FLOOR: usize = 256;

/// Where a session's record is in [`Sessions`]. A freed slot takes its next session under a new generation, so a
/// key kept past its record finds nothing, never another session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SessionKey {
    index: u32,
    generation: u32,
}

/// One record per session the store holds anything of, found by ID once. The slots stay within about twice the
/// records that hold something (see [`Sessions::sweep`]).
#[derive(Default)]
pub(crate) struct Sessions {
    slots: Vec<Slot>,
    keys: HashMap<SessionID, SessionKey>,
    /// Slots freed by a sweep, for the next new sessions.
    free: Vec<u32>,
    /// The slot count at which the next sweep runs.
    sweep_at: usize,
}

struct Slot {
    generation: u32,
    /// `None` once freed.
    session: Option<Session>,
}

/// Everything the store holds of one session.
#[derive(Default)]
pub(crate) struct Session {
    pub(crate) id: SessionID,
    pub(crate) info: Option<SessionInfo>,
    pub(crate) life: Life,
    /// `None` until an event or the `session.active` snapshot names the session.
    pub(crate) status: Option<SessionStatus>,
    /// The family this session keys, as its root or as the furthest known ancestor while the root is not loaded:
    /// every session of it, this one included once loaded. Empty when it keys none.
    pub(crate) family: Vec<SessionID>,
    /// The loaded messages; `None` until read or written.
    pub(crate) transcript: Option<Transcript>,
    /// The cursor of the next older page, while older pages remain.
    pub(crate) cursor: Option<String>,
    /// An older-page load runs.
    pub(crate) loading: bool,
    /// Pending inbox items in admission order.
    pub(crate) pending: Vec<SessionInboxInfo>,
    /// Pending permission requests; `None` until read or asked.
    pub(crate) permissions: Option<Vec<PermissionRequest>>,
    /// Pending forms; `None` until read or created.
    pub(crate) forms: Option<Vec<Form>>,
    /// The token of the transcript window that ended last, while it is one of the newest that ended; else 0.
    pub(crate) incarnation: u64,
    pub(crate) reads: SessionReads,
    /// 1 + its place in the changes the consumer has not taken, or 0. A record changes name there cannot be freed.
    pub(crate) dirty: u32,
    /// The inbox read in flight, by token, with the inbox events that overtook it.
    pub(crate) pending_read: Option<(u64, IndexMap<String, PendingUpdate>)>,
    /// The permission read in flight, with the asks and replies that overtook it.
    pub(crate) permission_read: Option<Overlay<PermissionRequest>>,
    /// The head read in flight, with what overtook it.
    pub(crate) head_read: Option<HeadRead>,
    /// The older-page load in flight, by token.
    pub(crate) message_load: Option<(u64, Task<bool>)>,
    /// The last admission, by token: each admission waits for the previous one to settle.
    pub(crate) sending: Option<(u64, Task<()>)>,
    pub(crate) compacting: Option<Compacting>,
    /// As the root of a synced job tree: the job IDs the server listed, plus those events added for owners in the
    /// tree. Loaded session info only reaches direct children, so parents alone would drop a grandchild's jobs.
    pub(crate) job_tree: Option<HashSet<String>>,
    /// The job read of the tree in flight, with the job events that overtook it.
    pub(crate) job_read: Option<Overlay<JobInfo>>,
}

/// Where a session stands between this client's creation of it and its deletion.
#[derive(Default)]
pub(crate) enum Life {
    /// Neither deleted nor being created by this client.
    #[default]
    Known,
    /// Deleted at deletion epoch `epoch`: one of the newest deletions.
    Missing { epoch: u64 },
    /// An optimistic creation in flight, by token; prompts to the session wait for `gate`.
    Creating { token: u64, gate: Task<()>, echo: Echo },
}

/// What the server said of a creation in flight.
pub(crate) enum Echo {
    /// Nothing yet: a failure rolls the record back.
    Awaited,
    /// The `session.created` echo or a response acknowledged it.
    Received,
    /// Acknowledged, then deleted at deletion epoch `epoch`.
    Deleted { epoch: u64 },
}

impl Life {
    /// The deletion epoch, while the session is one of the newest deletions.
    pub(crate) fn deleted(&self) -> Option<u64> {
        match self {
            Life::Missing { epoch } | Life::Creating { echo: Echo::Deleted { epoch }, .. } => Some(*epoch),
            _ => None,
        }
    }

    /// A creation of this client the server has not acknowledged.
    pub(crate) fn unacknowledged(&self) -> bool {
        matches!(self, Life::Creating { echo: Echo::Awaited, .. })
    }

    /// Acknowledges a creation; true when it was unacknowledged.
    pub(crate) fn acknowledge(&mut self) -> bool {
        let Life::Creating { echo, .. } = self else { return false };
        if !matches!(echo, Echo::Awaited) {
            return false;
        }
        *echo = Echo::Received;
        true
    }

    /// Marks the session deleted at `epoch`.
    pub(crate) fn delete(&mut self, epoch: u64) {
        match self {
            Life::Creating { echo, .. } => *echo = Echo::Deleted { epoch },
            _ => *self = Life::Missing { epoch },
        }
    }

    /// Forgets a deletion; true when there was one.
    pub(crate) fn undelete(&mut self) -> bool {
        match self {
            Life::Missing { .. } => *self = Life::Known,
            Life::Creating { echo: echo @ Echo::Deleted { .. }, .. } => *echo = Echo::Received,
            _ => return false,
        }
        true
    }

    /// Ends the creation `token`; true when it was the one in flight.
    fn end_creation(&mut self, token: u64) -> bool {
        let Life::Creating { token: current, echo, .. } = self else { return false };
        if *current != token {
            return false;
        }
        *self = match echo {
            Echo::Deleted { epoch } => Life::Missing { epoch: *epoch },
            _ => Life::Known,
        };
        true
    }
}

impl Session {
    /// True when the record holds nothing: the store then answers for the session as for one it never saw.
    fn is_vacant(&self) -> bool {
        let Session {
            id: _,
            info,
            life,
            status,
            family,
            transcript,
            cursor,
            loading,
            pending,
            permissions,
            forms,
            incarnation,
            reads,
            dirty,
            pending_read,
            permission_read,
            head_read,
            message_load,
            sending,
            compacting,
            job_tree,
            job_read,
        } = self;
        matches!(life, Life::Known)
            && info.is_none()
            && status.is_none()
            && family.is_empty()
            && transcript.is_none()
            && cursor.is_none()
            && !loading
            && pending.is_empty()
            && permissions.is_none()
            && forms.is_none()
            && *incarnation == 0
            && reads.is_idle()
            && *dirty == 0
            && pending_read.is_none()
            && permission_read.is_none()
            && head_read.is_none()
            && message_load.is_none()
            && sending.is_none()
            && compacting.is_none()
            && job_tree.is_none()
            && job_read.is_none()
    }
}

impl Sessions {
    pub(crate) fn key(&self, id: &(impl AsRef<str> + ?Sized)) -> Option<SessionKey> {
        self.keys.get(id.as_ref()).copied()
    }

    pub(crate) fn get(&self, id: &(impl AsRef<str> + ?Sized)) -> Option<&Session> {
        self.live(self.key(id)?)
    }

    pub(crate) fn get_mut(&mut self, id: &(impl AsRef<str> + ?Sized)) -> Option<&mut Session> {
        self.live_mut(self.key(id)?)
    }

    /// The key of `id`'s record, added empty when there is none.
    pub(crate) fn entry(&mut self, id: &(impl AsRef<str> + ?Sized)) -> SessionKey {
        let id = id.as_ref();
        if let Some(key) = self.key(id) {
            return key;
        }
        let session = Some(Session { id: SessionID::from(id), ..Session::default() });
        let key = match self.free.pop() {
            Some(index) => {
                let slot = &mut self.slots[index as usize];
                slot.session = session;
                SessionKey { index, generation: slot.generation }
            }
            None => {
                let index = u32::try_from(self.slots.len()).expect("fewer than 2^32 sessions");
                self.slots.push(Slot { generation: 0, session });
                SessionKey { index, generation: 0 }
            }
        };
        self.keys.insert(SessionID::from(id), key);
        key
    }

    /// The record of `key`, unless it was freed: a key kept across a write may outlive its record.
    pub(crate) fn live(&self, key: SessionKey) -> Option<&Session> {
        let slot = self.slots.get(key.index as usize)?;
        slot.session.as_ref().filter(|_| slot.generation == key.generation)
    }

    pub(crate) fn live_mut(&mut self, key: SessionKey) -> Option<&mut Session> {
        let slot = self.slots.get_mut(key.index as usize)?;
        let live = slot.generation == key.generation;
        slot.session.as_mut().filter(|_| live)
    }

    /// `id`'s record, added empty when there is none.
    pub(crate) fn get_or_insert(&mut self, id: &(impl AsRef<str> + ?Sized)) -> &mut Session {
        let key = self.entry(id);
        &mut self[key]
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = &Session> {
        self.slots.iter().filter_map(|slot| slot.session.as_ref())
    }

    pub(crate) fn iter_mut(&mut self) -> impl Iterator<Item = &mut Session> {
        self.slots.iter_mut().filter_map(|slot| slot.session.as_mut())
    }

    pub(crate) fn entries_mut(&mut self) -> impl Iterator<Item = (SessionKey, &mut Session)> {
        self.slots.iter_mut().enumerate().filter_map(|(index, slot)| {
            Some((SessionKey { index: index as u32, generation: slot.generation }, slot.session.as_mut()?))
        })
    }

    /// Frees the records that hold nothing, once the slots have doubled since the last sweep. Run it only as the
    /// consumer takes the changes: a freed slot goes to the next new session.
    pub(crate) fn sweep(&mut self) {
        if self.slots.len() < self.sweep_at.max(SWEEP_FLOOR) {
            return;
        }
        for (index, slot) in self.slots.iter_mut().enumerate() {
            let Some(session) = slot.session.take_if(|session| session.is_vacant()) else { continue };
            self.keys.remove(&session.id);
            slot.generation = slot.generation.wrapping_add(1);
            self.free.push(index as u32);
        }
        self.sweep_at = 2 * (self.slots.len() - self.free.len());
    }
}

impl Index<SessionKey> for Sessions {
    type Output = Session;

    fn index(&self, key: SessionKey) -> &Session {
        self.live(key).expect("a live session key")
    }
}

impl IndexMut<SessionKey> for Sessions {
    fn index_mut(&mut self, key: SessionKey) -> &mut Session {
        self.live_mut(key).expect("a live session key")
    }
}

/// Input of [`Data::session_create`].
#[derive(Debug, Clone, Default)]
pub struct CreateSession {
    pub id: Option<SessionID>,
    pub title: Option<String>,
    pub agent: Option<AgentID>,
    pub model: Option<ModelRef>,
    pub location: Option<LocationPublicRef>,
    pub project_id: Option<ProjectID>,
}

/// How an execution ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Outcome {
    Succeeded,
    Failed,
    Interrupted,
}

impl State {
    /// Loaded sessions, most recently updated first.
    pub fn sessions(&self) -> Vec<&SessionInfo> {
        let mut sessions: Vec<_> = self.sessions.iter().filter_map(|session| session.info.as_ref()).collect();
        sessions.sort_by(|a, b| b.time.updated.total_cmp(&a.time.updated));
        sessions
    }

    /// True when any session is loaded.
    pub fn has_sessions(&self) -> bool {
        self.sessions.iter().any(|session| session.info.is_some())
    }

    pub fn session(&self, id: &(impl AsRef<str> + ?Sized)) -> Option<&SessionInfo> {
        self.sessions.get(id.as_ref())?.info.as_ref()
    }

    /// True when the session is known to be deleted.
    pub fn is_missing(&self, id: &(impl AsRef<str> + ?Sized)) -> bool {
        self.sessions.get(id.as_ref()).is_some_and(|session| session.life.deleted().is_some())
    }

    /// True while an optimistic creation of the session is in flight.
    pub fn is_creating(&self, id: &(impl AsRef<str> + ?Sized)) -> bool {
        self.sessions.get(id.as_ref()).is_some_and(|session| matches!(session.life, Life::Creating { .. }))
    }

    /// The family root: the walk up `parentID` through loaded info stops at the first parent that
    /// is not loaded (the furthest known ancestor) or repeats. On a repeat it is the last session
    /// before the first one seen twice.
    pub fn root<'a>(&'a self, id: &'a (impl AsRef<str> + ?Sized)) -> &'a str {
        let parent = |id: &str| self.session(id).and_then(|info| info.parent_id.as_ref()).map(SessionID::as_str);
        // Quadratic in the family's depth, which is the subagent nesting and shallow.
        let (start, mut current, mut depth) = (id.as_ref(), id.as_ref(), 0);
        loop {
            let Some(next) = parent(current) else { return current };
            if std::iter::successors(Some(start), |&id| parent(id)).take(depth + 1).any(|seen| seen == next) {
                return current;
            }
            (current, depth) = (next, depth + 1);
        }
    }

    /// Every known session of the family of `id`.
    pub fn family(&self, id: &(impl AsRef<str> + ?Sized)) -> &[SessionID] {
        self.sessions.get(self.root(id)).map(|root| root.family.as_slice()).unwrap_or_default()
    }

    /// A child's own cost, or a root's cost with every known descendant.
    pub fn cost(&self, id: &(impl AsRef<str> + ?Sized)) -> f64 {
        let Some(session) = self.sessions.get(id.as_ref()) else { return 0.0 };
        let Some(info) = &session.info else { return 0.0 };
        if info.parent_id.is_some() || session.family.is_empty() {
            return info.cost;
        }
        session.family.iter().map(|member| self.session(member).map_or(0.0, |info| info.cost)).sum()
    }

    pub fn status(&self, id: &(impl AsRef<str> + ?Sized)) -> SessionStatus {
        self.sessions.get(id.as_ref()).and_then(|session| session.status).unwrap_or(SessionStatus::Idle)
    }

    /// Running sessions.
    pub fn active_sessions(&self) -> Vec<&SessionID> {
        self.sessions
            .iter()
            .filter(|session| session.status == Some(SessionStatus::Running))
            .map(|session| &session.id)
            .collect()
    }

    pub(crate) fn set_status(&mut self, id: &SessionID, status: SessionStatus) {
        if let Some((_, updates)) = &mut self.active_updates {
            updates.insert(id.clone(), Some(status));
        }
        let key = self.sessions.entry(id);
        if self.sessions[key].status.replace(status) != Some(status) {
            self.touch_key(key, Touched::STATUS);
        }
    }

    /// Stores fetched or optimistic info (`remember`).
    pub(crate) fn remember(&mut self, info: SessionInfo) {
        let key = self.sessions.entry(&info.id);
        self.clear_deleted(key);
        self.touch_key(key, Touched::INFO);
        let session = &mut self.sessions[key];
        session.reads[SessionRead::Info].complete();
        session.info = Some(info);
        self.register(key);
    }

    /// Adds a session to the family index; a tentative family keyed by the session folds into
    /// its resolved root (`registerSession`).
    pub(crate) fn register(&mut self, key: SessionKey) {
        if self.sessions[key].info.is_none() {
            return;
        }
        let root_key = self.root_key(key);
        if root_key != key {
            let orphans = std::mem::take(&mut self.sessions[key].family);
            let members = &mut self.sessions[root_key].family;
            for member in orphans {
                if !members.contains(&member) {
                    members.push(member);
                }
            }
        }
        // The root's family and cost cover this session.
        self.touch_key(root_key, Touched::INFO);
        let id = &self.sessions[key].id;
        if !self.sessions[root_key].family.contains(id) {
            let id = id.clone();
            self.sessions[root_key].family.push(id);
        }
    }

    pub(crate) fn remove_session(&mut self, id: &SessionID) {
        if let Some((_, updates)) = &mut self.active_updates {
            updates.insert(id.clone(), None);
        }
        let key = self.sessions.entry(id);
        self.end_transcript(key);
        let session = &mut self.sessions[key];
        session.reads.invalidate();
        for item in &session.pending {
            self.outbox.remove(item.id());
        }
        session.info = None;
        session.status = None;
        session.head_read = None;
        session.transcript = None;
        session.cursor = None;
        session.loading = false;
        session.pending = Vec::new();
        session.permissions = None;
        session.forms = None;
        self.remove_job_tree(key);
        for (root, session) in self.sessions.entries_mut() {
            if session.family.contains(id) {
                // The family and cost of its root change.
                self.log.touch(session, root, Touched::INFO);
                session.family.retain(|member| member != id);
            }
        }
        let gone = Touched::INFO | Touched::STATUS | Touched::SHAPE | Touched::PENDING | Touched::PERMISSIONS;
        self.touch_key(key, gone | Touched::FORMS);
    }

    /// Drops heavy cached data of one session, keeping unacknowledged submissions
    /// (`evictSession`).
    fn evict_session(&mut self, key: SessionKey) {
        if self.sessions[key].life.unacknowledged() {
            return;
        }
        self.end_transcript(key);
        let session = &mut self.sessions[key];
        session.reads[SessionRead::Pending].invalidate();
        session.reads[SessionRead::Messages].invalidate();
        session.message_load = None;
        session.head_read = None;
        session.cursor = None;
        session.loading = false;
        session.pending.retain(|item| self.outbox.contains(item.id()));
        session.pending.shrink_to_fit();
        if let Some(transcript) = &mut session.transcript {
            transcript.retain(|item| self.outbox.contains(item.id()));
            if transcript.items().is_empty() {
                session.transcript = None;
            }
        }
        self.touch_key(key, Touched::SHAPE | Touched::PENDING);
    }

    /// Clears heavy cached data of the root and every known descendant (`evict`).
    pub(crate) fn evict(&mut self, id: &SessionID) {
        let key = self.sessions.entry(id);
        let root = self.root_key(key);
        let mut members = vec![root, key];
        // A family lists only sessions with info, so each has a record.
        members.extend(self.sessions[root].family.iter().filter_map(|member| self.sessions.key(member)));
        for (index, key) in members.iter().enumerate() {
            if !members[..index].contains(key) {
                self.evict_session(*key);
            }
        }
    }

    /// The key of the family root of the session `key`, its record added when missing.
    fn root_key(&mut self, key: SessionKey) -> SessionKey {
        match self.sessions.key(self.root(&self.sessions[key].id)) {
            Some(root) => root,
            None => {
                let root = SessionID::from(self.root(&self.sessions[key].id));
                self.sessions.entry(&root)
            }
        }
    }

    fn edit_info(&mut self, id: &SessionID, f: impl FnOnce(&mut SessionInfo)) {
        let Some(key) = self.sessions.key(id) else { return };
        let Some(info) = &mut self.sessions[key].info else { return };
        f(info);
        self.touch_key(key, Touched::INFO);
        // A child's cost is part of its root's.
        let root = self.root_key(key);
        self.touch_key(root, Touched::INFO);
    }

    /// True when a session read is worth revalidating: its info is loaded or a read is active.
    fn known(&self, id: &SessionID) -> bool {
        self.session(id).is_some() || self.has_read(Read::Session(id.as_str(), SessionRead::Info))
    }

    fn revalidate(&mut self, id: &SessionID) -> Vec<Follow> {
        if !self.known(id) {
            return Vec::new();
        }
        self.invalidate(Read::Session(id.as_str(), SessionRead::Info));
        vec![Follow::Session(id.clone())]
    }

    pub(crate) fn on_session_created(&mut self, data: &SessionCreatedData) -> Vec<Follow> {
        let id = &data.session_id;
        if let Some(key) = self.sessions.key(id) {
            self.clear_deleted(key);
            self.sessions[key].life.acknowledge();
        }
        self.invalidate(Read::Session(id.as_str(), SessionRead::Info));
        // A new session starts empty, so live events are its source of truth. Separate pending and
        // message reads could both miss an input promoted between them and overwrite the events.
        let reads = &mut self.sessions.get_or_insert(id).reads;
        reads[SessionRead::Pending].complete();
        reads[SessionRead::Messages].complete();
        vec![Follow::Session(id.clone())]
    }

    pub(crate) fn on_usage_updated(&mut self, data: &SessionUsageUpdatedData) {
        self.edit_info(&data.session_id, |info| {
            info.cost = data.cost;
            info.tokens = data.tokens.clone();
        });
    }

    pub(crate) fn on_agent_selected(&mut self, event: &SessionAgentSelected) {
        let data = &event.data;
        let previous = self.session(&data.session_id).and_then(|info| info.agent.clone());
        self.edit_info(&data.session_id, |info| info.agent = Some(data.agent.clone()));
        self.touch_selected(&data.session_id);
        let row = SessionMessageAgentSelected {
            id: from_event(&event.id),
            r#type: tag::AgentSwitched,
            agent: data.agent.clone(),
            previous,
            metadata: None,
            time: SessionInboxUserTime { created: event.created },
        };
        self.insert_message(&data.session_id, SessionMessageInfo::AgentSwitched(row));
    }

    pub(crate) fn on_model_selected(&mut self, event: &SessionModelSelected) -> Vec<Follow> {
        let data = &event.data;
        let previous =
            data.previous.clone().or_else(|| self.session(&data.session_id).and_then(|info| info.model.clone()));
        self.edit_info(&data.session_id, |info| info.model = Some(data.model.clone()));
        self.touch_selected(&data.session_id);
        // A head read in flight places the row (models M2, O3).
        let shown = self.sessions.get(&data.session_id);
        if !shown.is_some_and(|session| session.transcript.is_some() || session.head_read.is_some()) {
            return Vec::new();
        }
        let id = from_event(&event.id);
        let row = SessionMessageModelSelected {
            id: id.clone(),
            r#type: tag::ModelSwitched,
            model: data.model.clone(),
            previous,
            metadata: None,
            time: SessionInboxUserTime { created: event.created },
        };
        self.insert_message(&data.session_id, SessionMessageInfo::ModelSwitched(row));
        vec![Follow::Message(data.session_id.clone(), id)]
    }

    pub(crate) fn on_moved(&mut self, event: &SessionMoved) {
        let data = &event.data;
        let Some(current) = self.session(&data.session_id) else { return };
        let previous = SessionMessageLocationSwitchedPrevious {
            location: current.location.clone(),
            project_id: Some(current.project_id.clone()),
            subpath: current.subpath.clone(),
        };
        let location = LocationPublicRef { directory: data.location.directory.clone() };
        self.edit_info(&data.session_id, |info| {
            info.location = location.clone();
            info.project_id = data.project_id.clone();
            info.subpath = data.subpath.clone();
        });
        let row = SessionMessageLocationSwitched {
            id: from_event(&event.id),
            r#type: tag::LocationSwitched,
            project_id: Some(data.project_id.clone()),
            subpath: data.subpath.clone(),
            location,
            previous: Some(Some(previous)),
            metadata: None,
            time: SessionInboxUserTime { created: event.created },
        };
        self.insert_message(&data.session_id, SessionMessageInfo::LocationSwitched(row));
    }

    pub(crate) fn on_permissions(&mut self, data: &SessionPermissionsData) {
        self.edit_info(&data.session_id, |info| info.permissions = Some(data.permissions.clone()));
    }

    pub(crate) fn on_metadata(&mut self, data: &SessionMetadataUpdatedData) {
        // The event carries the whole record, so keys it drops go too.
        self.edit_info(&data.session_id, |info| info.metadata = Some(data.metadata.clone()));
    }

    pub(crate) fn on_archived(&mut self, id: &SessionID, archived: Option<f64>) {
        self.edit_info(id, |info| info.time.archived = archived);
    }

    pub(crate) fn on_revert_staged(&mut self, data: &SessionRevertStagedData) {
        self.edit_info(&data.session_id, |info| info.revert = Some(data.revert.clone()));
    }

    pub(crate) fn on_revert_cleared(&mut self, id: &SessionID) {
        self.edit_info(id, |info| info.revert = None);
    }

    pub(crate) fn on_revert_committed(&mut self, data: &SessionRevertCommittedData) {
        let id = &data.session_id;
        self.on_revert_cleared(id);
        // The projector also deletes inbox items enqueued at or after the boundary, without a
        // cancel event.
        let key = self.sessions.entry(id);
        self.sessions[key].pending.retain(|item| item.id() < data.to.as_str());
        self.touch_key(key, Touched::PENDING);
        self.end_transcript(key);
        self.revert_messages(id, &data.to);
    }

    pub(crate) fn on_execution_started(&mut self, id: &SessionID) -> Vec<Follow> {
        self.set_status(id, SessionStatus::Running);
        // Revalidate so `time.busy` follows the projected execution start.
        self.revalidate(id)
    }

    pub(crate) fn on_execution_ended(
        &mut self,
        event_id: &EventID,
        created: f64,
        id: &SessionID,
        outcome: Outcome,
        error: Option<&SessionStructuredError>,
        shutdown: bool,
    ) -> Vec<Follow> {
        self.set_status(id, SessionStatus::Idle);
        self.clear_retry(id);
        if shutdown {
            return Vec::new();
        }
        // Mirror the projected idle marker so turn boundaries match before the next read.
        let row = SessionMessageIdle {
            id: from_event(event_id),
            r#type: tag::Idle,
            outcome: match outcome {
                Outcome::Succeeded => SessionInfoOutcome::Succeeded,
                Outcome::Failed => SessionInfoOutcome::Failed,
                Outcome::Interrupted => SessionInfoOutcome::Interrupted,
            },
            error: error.cloned(),
            metadata: None,
            time: SessionInboxUserTime { created },
        };
        self.insert_message(id, SessionMessageInfo::Idle(row));
        let mut follow = Vec::new();
        if self.has_live_tool(id) {
            self.invalidate(Read::Session(id.as_str(), SessionRead::Messages));
            follow.push(Follow::Messages(id.clone()));
        }
        // An event can overtake the first read; revalidate when that read is still active.
        follow.extend(self.revalidate(id));
        follow
    }

    pub(crate) fn on_viewed(&mut self, id: &SessionID) -> Vec<Follow> {
        self.revalidate(id)
    }
}

impl Data {
    /// Reads a session once per invalidation (`session.sync`); with `children`, also every direct
    /// child, under its own key.
    pub fn session_sync(&self, id: &SessionID, children: bool) -> Task<()> {
        let read = if children { SessionRead::Family } else { SessionRead::Info };
        let id = id.clone();
        self.sync_start(
            self.keyed(Read::Session(id.as_str(), read)),
            |state, _| state.deletion_epoch,
            move |data, started| async move {
                let info = async {
                    data.client()
                        .session_get(&SessionGetInput { session_id: id.clone() })
                        .await
                        .map_err(|error| evict_missing(&data, error))
                };
                let family = async {
                    if !children {
                        return Ok(Vec::new());
                    }
                    list_children(&data, &id).await
                };
                let (info, family) = futures_util::future::try_join(info, family).await?;
                data.write(|state| {
                    for session in std::iter::once(info).chain(family) {
                        if state.deleted_since(&session.id, started) {
                            continue;
                        }
                        state.remember(session);
                    }
                });
                Ok(())
            },
        )
    }

    pub fn session_invalidate(&self, id: &SessionID) {
        self.write(|state| state.invalidate(Read::Session(id.as_str(), SessionRead::Info)));
    }

    /// Stores fetched info, as a list read does.
    pub fn remember(&self, info: SessionInfo) {
        self.write(|state| state.remember(info));
    }

    pub fn set_status(&self, id: &SessionID, status: SessionStatus) {
        self.write(|state| state.set_status(id, status));
    }

    /// Forgets a session as deleted.
    pub fn forget(&self, id: &SessionID) {
        self.write(|state| state.mark_deleted(id));
    }

    /// Clears heavy cached data of the family of `id`.
    pub fn evict(&self, id: &SessionID) {
        self.write(|state| state.evict(id));
    }

    /// Optimistic creation: admits a local record under a client-minted ID so a session view can
    /// open at once, then creates the session. Prompts to it wait for the request; a failure
    /// removes the record unless the server acknowledged it.
    pub fn session_create(&self, input: CreateSession) -> (SessionID, Task<SessionInfo>) {
        let id = input.id.clone().unwrap_or_else(|| SessionID(opencode_api::id::session()));
        let mut state = self.lock();
        let location = input.location.clone().unwrap_or_else(|| LocationPublicRef {
            directory: AbsolutePath(state.default_location().directory.clone()),
        });
        let fresh = state.session(&id).is_none();
        let key = state.sessions.entry(&id);
        state.clear_deleted(key);
        if fresh {
            let created = now();
            let project_id = input
                .project_id
                .clone()
                .or_else(|| {
                    state
                        .location(Some(&(&location).into()))
                        .and_then(|data| data.info.as_ref())
                        .map(|info| info.project.id.clone())
                })
                .unwrap_or_default();
            state.remember(SessionInfo {
                id: id.clone(),
                project_id,
                agent: input.agent.clone(),
                model: input.model.clone(),
                cost: 0.0,
                tokens: TokenUsageInfo::default(),
                time: SessionInfoTime { created, updated: created, ..Default::default() },
                title: input.title.clone(),
                location: location.clone(),
                ..Default::default()
            });
            // A mounted optimistic session must not read its empty collections before creation
            // settles; the `session.created` echo reads its info again.
            for read in [SessionRead::Family, SessionRead::Pending, SessionRead::Messages] {
                state.sessions[key].reads[read].complete();
            }
        }
        let request = SessionCreateInput {
            id: Some(Some(id.clone())),
            title: input.title.map(Some),
            agent: input.agent.map(Some),
            model: input.model.map(Some),
            location: Some(Some(location)),
            ..Default::default()
        };
        let token = state.token();
        let data = self.clone();
        let session = id.clone();
        let task = self.spawn(async move {
            let result = data.client().session_create(&request).await.map_err(Error::new);
            data.write(|state| {
                // A failure of a call that admitted nothing leaves another call's creation unacknowledged.
                let acknowledged = (result.is_ok() || fresh)
                    && state.sessions.get_mut(&session).is_some_and(|record| record.life.acknowledge());
                match &result {
                    Ok(info) => state.remember(info.clone()),
                    // Roll back only a record this call admitted and neither the echo nor the
                    // response acknowledged: anything else is server state.
                    Err(_) => {
                        if acknowledged {
                            state.remove_session(&session);
                        }
                    }
                }
                if state.sessions.get_mut(&session).is_some_and(|record| record.life.end_creation(token)) {
                    // `is_creating` is part of the session's view.
                    state.touch(&session, Touched::INFO);
                }
            });
            result
        });
        if fresh {
            let gate = task.clone().map(|result| result.map(|_| ())).boxed().shared();
            state.sessions[key].life = Life::Creating { token, gate, echo: Echo::Awaited };
        }
        self.flush(&mut state);
        (id, task)
    }
}

/// Every direct child, newest first, through every page (`listChildren`).
async fn list_children(data: &Data, parent: &SessionID) -> Result<Vec<SessionInfo>, Error> {
    let mut input = SessionListInput {
        parent_id: Some(Some(parent.clone())),
        order: Some(SessionListInputOrder::Desc),
        limit: Some(CHILD_PAGE),
        ..Default::default()
    };
    let mut children = Vec::new();
    loop {
        let page = data.client().session_list(&input).await.map_err(Error::new)?;
        let full = page.data.len() as i64 >= CHILD_PAGE;
        children.extend(page.data);
        let Some(next) = page.cursor.next.flatten().filter(|_| full) else { return Ok(children) };
        // Later pages carry only the cursor and the size, as in TS.
        input = SessionListInput { cursor: Some(next), limit: Some(CHILD_PAGE), ..Default::default() };
    }
}

impl Data {
    /// Refetches one projected message and upserts it (the `session.model.selected` read). A response that
    /// arrives after the transcript was deleted, evicted or reverted publishes nothing (deviation
    /// O6-held-message-read).
    pub(crate) fn fetch_message(&self, session: SessionID, message: SessionMessageID) {
        let incarnation = self.read(|state| state.incarnation(&session));
        self.refresh(move |data| async move {
            let item = data
                .client()
                .session_message_get(&SessionMessageGetInput { session_id: session.clone(), message_id: message })
                .await
                .map_err(Error::new)?;
            data.write(|state| {
                // A head read dropped the row as older than its page, or the window ended.
                if state.incarnation(&session) != incarnation || state.message(&session, item.id()).is_none() {
                    return;
                }
                let item = state.stored(item);
                state.upsert_message(&session, item);
            });
            Ok(())
        });
    }

    /// Applies a live title after the session's reads, so a racing read cannot overwrite it.
    pub(crate) fn renamed(&self, session: SessionID, title: String) {
        self.refresh(|data| async move {
            let family = data.read(|state| {
                matches!(
                    state.read_state(Read::Session(session.as_str(), SessionRead::Family)),
                    Some(ReadState::Loading { .. })
                )
            });
            let own = data.session_sync(&session, false);
            if family {
                futures_util::future::try_join(own, data.session_sync(&session, true)).await?;
            } else {
                own.await?;
            }
            data.write(|state| state.edit_info(&session, |info| info.title = Some(title)));
            Ok(())
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::changes::Dirty;

    fn id(n: usize) -> SessionID {
        SessionID(format!("ses_{n}"))
    }

    /// The store remembers the newest 512 deletions, and the records of sessions it forgot go to new sessions.
    #[test]
    fn forgotten_deletions_free_their_records() {
        let (mut state, mut dirty) = (State::default(), Dirty::default());
        for n in 0..4096 {
            state.mark_deleted(&id(n));
            state.take(&mut dirty);
        }
        assert!(state.is_missing(&id(4095)) && state.is_missing(&id(4096 - 512)));
        assert!(!state.is_missing(&id(4095 - 512)));
        assert!(state.sessions.slots.len() <= 3 * 512, "{} slots", state.sessions.slots.len());
    }

    /// A record the consumer has not taken changes of is not freed: it reads the record after the take.
    #[test]
    fn a_record_named_by_untaken_changes_is_kept() {
        let (mut state, mut dirty) = (State::default(), Dirty::default());
        // Each take sweeps first; the second has twice the records of the first, so it sweeps again.
        for round in 0..2 {
            for n in round * SWEEP_FLOOR..(round + 1) * SWEEP_FLOOR {
                state.touch(&id(n), Touched::INFO);
            }
            state.take(&mut dirty);
            let last = (round + 1) * SWEEP_FLOOR - 1;
            assert!(state.sessions.key(&id(last)).is_some(), "freed before the consumer read it");
        }
        assert!(state.sessions.key(&id(0)).is_none(), "kept after the consumer read it");
    }
}
