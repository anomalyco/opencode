//! The store contents as plain data. [`crate::Data`] owns them on its thread and runs their requests.

use std::collections::{HashMap, HashSet};
use std::hash::Hash;
use std::sync::Arc;

use indexmap::{IndexMap, IndexSet};
use opencode_api::generated::{JobInfo, Project, ProjectID, SessionID, SessionMessageID};

use crate::changes::{Log, Touched};
use crate::forms::Form;
use crate::location::{Location, LocationData};
use crate::reads::{ReadKey, ReadState};
use crate::sessions::{SessionKey, Sessions};

/// A store error. Shared, because one keyed read answers every caller.
pub type Error = Arc<opencode_api::error::Error>;

/// Raw messages of the first transcript read (`messagePageLimit`).
pub(crate) const MESSAGE_PAGE: i64 = 20;

/// Remembered deletions (`DELETED_SESSION_LIMIT`).
const DELETED_LIMIT: usize = 512;

#[derive(Debug, Clone, Default)]
pub struct Options {
    /// The default location directory (`CreateDataInput.directory`).
    pub directory: String,
    /// Raw messages of the first transcript read; later pages keep their size.
    pub initial_message_limit: Option<i64>,
    /// Drops inline `data:` payloads of tool-result files before they enter the store. Change it later with
    /// [`crate::Data::set_omit_tool_file_data`].
    pub omit_tool_file_data: bool,
}

/// `DataSessionStatus`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStatus {
    Idle,
    Running,
}

/// The store contents and its bookkeeping. Read it through [`crate::Data::read`].
#[derive(Default)]
pub struct State {
    pub(crate) sessions: Sessions,
    /// Pending forms of [`crate::forms::GLOBAL`]; `None` until read or created. A session's own are in its record.
    pub(crate) global_forms: Option<Vec<Form>>,
    /// In insertion order, as the TS store's keys: projects that sort equal keep it.
    pub(crate) projects: IndexMap<ProjectID, Project>,
    pub(crate) locations: HashMap<Location, LocationData>,
    pub(crate) default_location: Location,
    pub(crate) omit_file_data: bool,

    pub(crate) log: Log,
    /// A `server.connected` arrived before; the next one is a reconnect.
    pub(crate) connected: bool,
    /// The keyed reads that belong to no session; a session's are in its record.
    pub(crate) reads: HashMap<ReadKey, ReadState>,
    /// The locations a keyed read or a change names, by [`crate::reads::LocationKey`].
    pub(crate) read_locations: IndexSet<Location>,
    /// Batches being applied; flushes wait for the outermost.
    pub(crate) batch: u32,
    next_token: u64,
    /// Status events received while a `session.active` snapshot is in flight, by connection.
    pub(crate) active_updates: Option<(u64, StatusUpdates)>,
    /// Inbox IDs of optimistic admissions the server has not acknowledged.
    pub(crate) outbox: HashSet<String>,
    pub(crate) deletion_epoch: u64,
    /// The newest [`DELETED_LIMIT`] deletions, oldest first: the sessions whose [`crate::sessions::Life`] holds a deletion
    /// epoch.
    deleted: IndexSet<SessionKey>,
    /// The sessions whose transcript window ended last (deleted, evicted or reverted), oldest first: the newest
    /// [`DELETED_LIMIT`], the only ones with an incarnation.
    ended: IndexSet<SessionKey>,
    /// The token of the newest trailing refetch timer, by the read it refetches.
    pub(crate) settling: HashMap<ReadKey, u64>,
    /// The form read in flight per owner (and location, for [`crate::forms::GLOBAL`]), with the
    /// forms created and settled that overtook it.
    pub(crate) form_reads: HashMap<crate::forms::FormRead, Overlay<Form>>,
    /// Running background jobs by ID, of the trees synced and of job events since (`store.job`).
    pub(crate) jobs: IndexMap<String, JobInfo>,
    /// The session and position of the message an event edited last.
    pub(crate) last_edited: Option<(SessionKey, usize)>,
    /// The `durable.seq` of the event being applied, for the rows it creates.
    pub(crate) event_seq: Option<i64>,
}

/// Maximum changes retained by one in-flight list read.
pub(crate) const OVERLAY_LIMIT: usize = 1024;

/// Changes that overtake a list read, keyed by ID in arrival order. Only the current ticket can publish. Beyond
/// [`OVERLAY_LIMIT`], retry instead of losing an item.
#[derive(Debug, Clone)]
pub(crate) struct Overlay<V> {
    ticket: u64,
    /// `None` once overflowed.
    changes: Option<IndexMap<String, Option<V>>>,
}

impl<V> Overlay<V> {
    pub(crate) fn new(ticket: u64) -> Self {
        Self { ticket, changes: Some(IndexMap::new()) }
    }

    /// The ticket of the read this overlay belongs to.
    pub(crate) fn ticket(&self) -> u64 {
        self.ticket
    }

    /// Ends the read `ticket` of `key`: its overlay, while that read is still the current one.
    pub(crate) fn take<K: Hash + Eq>(reads: &mut HashMap<K, Self>, key: &K, ticket: u64) -> Option<Self> {
        if reads.get(key)?.ticket != ticket {
            return None;
        }
        reads.remove(key)
    }

    pub(crate) fn record(&mut self, id: &str, change: Option<V>) {
        let Some(changes) = &mut self.changes else { return };
        changes.insert(id.to_owned(), change);
        if changes.len() > OVERLAY_LIMIT {
            self.changes = None;
        }
    }

    /// Applies the changes over the snapshot `list`, keeping its order and appending new items in
    /// arrival order. `None` when the overlay overflowed.
    pub(crate) fn apply(self, mut list: Vec<V>, id: impl Fn(&V) -> &str) -> Option<Vec<V>> {
        for (key, change) in self.changes? {
            match change {
                Some(item) if list.iter().all(|old| id(old) != key) => list.push(item),
                Some(_) => {}
                None => list.retain(|old| id(old) != key),
            }
        }
        Some(list)
    }

    /// The changes by ID in arrival order, for a caller that applies them itself. `None` when the
    /// overlay overflowed.
    pub(crate) fn into_changes(self) -> Option<IndexMap<String, Option<V>>> {
        self.changes
    }
}

/// Status events by session; `None` removes the session.
pub(crate) type StatusUpdates = HashMap<SessionID, Option<SessionStatus>>;

/// An in-flight compaction admission (`compacting`).
pub(crate) struct Compacting {
    pub(crate) id: SessionMessageID,
    /// Inbox IDs consumed or echoed while the request runs, so its response cannot resurrect them.
    pub(crate) observed: HashSet<String>,
    /// The token of the request.
    pub(crate) token: u64,
}

impl State {
    pub(crate) fn new(options: &Options) -> Self {
        Self {
            omit_file_data: options.omit_tool_file_data,
            default_location: Location::new(options.directory.clone()),
            ..Self::default()
        }
    }

    pub(crate) fn token(&mut self) -> u64 {
        self.next_token += 1;
        self.next_token
    }

    pub(crate) fn clear_deleted(&mut self, key: SessionKey) {
        if self.sessions[key].life.undelete() {
            self.deleted.shift_remove(&key);
            self.touch_key(key, Touched::INFO);
        }
    }

    pub(crate) fn mark_deleted(&mut self, id: &SessionID) {
        if self.sessions.get(id).is_some_and(|session| session.life.unacknowledged()) {
            return;
        }
        let key = self.sessions.entry(id);
        self.deleted.shift_remove(&key);
        self.deletion_epoch += 1;
        self.deleted.insert(key);
        if self.deleted.len() > DELETED_LIMIT
            && let Some(oldest) = self.deleted.shift_remove_index(0)
        {
            self.sessions[oldest].life.undelete();
        }
        self.sessions[key].life.delete(self.deletion_epoch);
        self.remove_session(id);
    }

    /// Marks the session of a `SessionNotFoundError` deleted (`evictMissing`).
    pub(crate) fn evict_missing(&mut self, error: &Error) {
        if let Some(id) = session_not_found(error) {
            self.mark_deleted(&id);
        }
    }

    /// True when `id` was deleted after the epoch a read started at.
    pub(crate) fn deleted_since(&self, id: &(impl AsRef<str> + ?Sized), started: u64) -> bool {
        self.sessions.get(id).and_then(|session| session.life.deleted()).unwrap_or(0) > started
    }

    /// The incarnation of `id`'s transcript window. A completion publishes into the window only while it is the
    /// incarnation the completion began in (models M2 rule 5, deviation O6-held-message-read).
    pub(crate) fn incarnation(&self, id: &SessionID) -> u64 {
        self.sessions.get(id).map_or(0, |session| session.incarnation)
    }

    /// Ends a transcript window, so completions that began in it publish nothing. The token counter never
    /// repeats, so a later window never matches an earlier incarnation.
    pub(crate) fn end_transcript(&mut self, key: SessionKey) {
        let token = self.token();
        self.ended.shift_remove(&key);
        self.ended.insert(key);
        self.sessions[key].incarnation = token;
        if self.ended.len() > DELETED_LIMIT
            && let Some(oldest) = self.ended.shift_remove_index(0)
        {
            self.sessions[oldest].incarnation = 0;
        }
    }
}

pub(crate) fn is_tag(error: &Error, tag: &str) -> bool {
    error.declared().is_some_and(|declared| declared.tag.as_deref() == Some(tag))
}

/// The session of a `SessionNotFoundError`.
pub(crate) fn session_not_found(error: &Error) -> Option<SessionID> {
    let declared = error.declared()?;
    if declared.tag.as_deref() != Some("SessionNotFoundError") {
        return None;
    }
    declared.body.get("sessionID").and_then(serde_json::Value::as_str).map(|id| SessionID(id.to_owned()))
}
