//! Paged transcripts and streaming message updates.

use opencode_api::generated::*;
use serde_json::Value;
use std::collections::HashMap;
use std::collections::HashSet;

use crate::changes::Touched;
use crate::core::{Delta, Effect, Head, Ticket};
use crate::sessions::{Anchor, SessionKey};
use crate::state::{Error, OVERLAY_LIMIT, State};

/// Sizes of the older pages that a new read of the newest page may read to reach the loaded history
/// (`bridgePageLimits`). They grow: a short gap costs one small page, and the longest gap closed costs three requests.
pub(crate) const BRIDGE_PAGE_LIMITS: [i64; 3] = [20, 40, 140];

/// What a head read fetched: the newest page with any bridging older pages (oldest last, as the server returns them),
/// the cursor after the oldest fetched page, and refreshed copies of unsettled kept messages.
pub(crate) struct HeadPages {
    pub(crate) data: Vec<SessionMessageInfo>,
    pub(crate) next: Option<String>,
    pub(crate) refreshed: HashMap<String, SessionMessageInfo>,
}

/// A message that later events still change (`unsettled`). A client that missed those events holds it as it was.
fn unsettled(message: &SessionMessageInfo) -> bool {
    match message {
        SessionMessageInfo::Assistant(assistant) => {
            assistant.time.completed.is_none()
                || assistant.content.iter().any(|part| {
                    matches!(
                        part,
                        SessionMessageAssistantContentItem::Tool(SessionMessageAssistantTool {
                            state: SessionMessageAssistantToolState::Streaming(_)
                                | SessionMessageAssistantToolState::Running(_),
                            ..
                        })
                    )
                })
        }
        SessionMessageInfo::Shell(shell) => shell.status == SessionMessageShellStatus::Running,
        SessionMessageInfo::Compaction(SessionMessageCompaction::Running(_)) => true,
        _ => false,
    }
}

/// A message's key in its transcript, never given to another message of it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct MessageKey(pub u32);

/// One session's loaded messages, oldest first, found by ID or by key.
#[derive(Debug, Clone, Default)]
pub struct Transcript {
    items: Vec<SessionMessageInfo>,
    /// The key of each item.
    keys: Vec<MessageKey>,
    /// The position of each key's item, by key; `u32::MAX` once it left. The next key is its length.
    positions: Vec<u32>,
    index: HashMap<String, usize>,
}

impl Transcript {
    pub fn items(&self) -> &[SessionMessageInfo] {
        &self.items
    }

    /// The key of each item.
    pub fn keys(&self) -> &[MessageKey] {
        &self.keys
    }

    pub fn get(&self, id: &str) -> Option<&SessionMessageInfo> {
        self.index.get(id).map(|&position| &self.items[position])
    }

    pub fn contains(&self, id: &str) -> bool {
        self.index.contains_key(id)
    }

    /// The key of message `id`.
    pub fn key(&self, id: &str) -> Option<MessageKey> {
        self.index.get(id).map(|&position| self.keys[position])
    }

    /// Where the message of `key` is.
    pub fn position(&self, key: MessageKey) -> Option<usize> {
        self.positions.get(key.0 as usize).filter(|position| **position != u32::MAX).map(|position| *position as usize)
    }

    pub fn by_key(&self, key: MessageKey) -> Option<&SessionMessageInfo> {
        self.position(key).map(|position| &self.items[position])
    }

    pub(crate) fn get_mut(&mut self, id: &str) -> Option<&mut SessionMessageInfo> {
        let position = *self.index.get(id)?;
        self.items.get_mut(position)
    }

    /// The items to change in place: their number and order stay.
    pub(crate) fn items_mut(&mut self) -> &mut [SessionMessageInfo] {
        &mut self.items
    }

    fn mint(&mut self) -> MessageKey {
        self.positions.push(u32::MAX);
        MessageKey(self.positions.len() as u32 - 1)
    }

    /// Replaces every item. One that was here by ID keeps its key, so its rows stay.
    pub(crate) fn replace(&mut self, items: Vec<SessionMessageInfo>) {
        for key in &self.keys {
            self.positions[key.0 as usize] = u32::MAX;
        }
        let mut keys = Vec::with_capacity(items.len());
        for (position, item) in items.iter().enumerate() {
            let kept = self.index.get(item.id()).map(|&old| self.keys[old]);
            let key = match kept.filter(|key| self.positions[key.0 as usize] == u32::MAX) {
                Some(key) => key,
                None => self.mint(),
            };
            self.positions[key.0 as usize] = position as u32;
            keys.push(key);
        }
        (self.items, self.keys) = (items, keys);
        self.index.clear();
        self.reindex(0);
    }

    /// Puts `older` before the items, each under a new key.
    pub(crate) fn prepend(&mut self, mut older: Vec<SessionMessageInfo>) {
        let mut keys: Vec<MessageKey> = (0..older.len()).map(|_| self.mint()).collect();
        keys.append(&mut self.keys);
        older.append(&mut self.items);
        (self.items, self.keys) = (older, keys);
        self.reindex(0);
    }

    /// Keeps only the items `keep` accepts, with their keys, and gives back the room of the rest.
    pub(crate) fn retain(&mut self, keep: impl Fn(&SessionMessageInfo) -> bool) {
        for (item, key) in self.items.iter().zip(&self.keys) {
            if !keep(item) {
                self.positions[key.0 as usize] = u32::MAX;
            }
        }
        self.keys.retain(|key| self.positions[key.0 as usize] != u32::MAX);
        self.items.retain(keep);
        self.index = HashMap::new();
        self.reindex(0);
        self.items.shrink_to_fit();
        self.keys.shrink_to_fit();
    }

    /// Appends unless the ID is present; reports whether it did.
    pub(crate) fn append(&mut self, item: SessionMessageInfo) -> bool {
        if self.index.contains_key(item.id()) {
            return false;
        }
        let key = self.mint();
        self.positions[key.0 as usize] = self.items.len() as u32;
        self.index.insert(item.id().to_owned(), self.items.len());
        self.items.push(item);
        self.keys.push(key);
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

    /// Removes `id` and returns its former position, if present.
    pub(crate) fn remove(&mut self, id: &str) -> Option<usize> {
        let position = self.index.remove(id)?;
        self.items.remove(position);
        let key = self.keys.remove(position);
        self.positions[key.0 as usize] = u32::MAX;
        self.reindex(position);
        Some(position)
    }

    /// Moves the item to the end and returns its former position, if present.
    pub(crate) fn move_last(&mut self, id: &str) -> Option<usize> {
        let position = self.index.get(id).copied()?;
        let item = self.items.remove(position);
        self.items.push(item);
        let key = self.keys.remove(position);
        self.keys.push(key);
        self.reindex(position);
        Some(position)
    }

    /// Drops every item from `position` on.
    pub(crate) fn truncate(&mut self, position: usize) {
        for key in self.keys.drain(position..) {
            self.positions[key.0 as usize] = u32::MAX;
        }
        for item in self.items.drain(position..) {
            self.index.remove(item.id());
        }
    }

    fn reindex(&mut self, start: usize) {
        for (position, item) in self.items.iter().enumerate().skip(start) {
            match self.index.get_mut(item.id()) {
                Some(at) => *at = position,
                None => {
                    self.index.insert(item.id().to_owned(), position);
                }
            }
            self.positions[self.keys[position].0 as usize] = position as u32;
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
    fn created(&self) -> f64;
    fn set_created(&mut self, created: f64);
}

impl MessageExt for SessionMessageInfo {
    fn created(&self) -> f64 {
        self.time_created()
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
        let ToolContent::File(file) = item else { continue };
        if file.uri.starts_with("data:") {
            file.uri = format!("data:{};base64,", file.mime);
        }
    }
}

/// A tool file whose `data:` payload [`omit_file_data`] emptied (`isDroppedFile`).
fn is_dropped_file(item: &ToolContent) -> bool {
    let ToolContent::File(file) = item else { return false };
    file.uri.strip_prefix("data:").and_then(|rest| rest.strip_suffix(";base64,")) == Some(file.mime.as_str())
}

fn tool_content(tool: &SessionMessageAssistantTool) -> Option<&[ToolContent]> {
    match &tool.state {
        SessionMessageAssistantToolState::Completed(state) => Some(&state.content),
        SessionMessageAssistantToolState::Error(state) => state.content.as_deref(),
        _ => None,
    }
}

fn has_dropped_file(tool: &SessionMessageAssistantTool) -> bool {
    tool_content(tool).is_some_and(|content| content.iter().any(is_dropped_file))
}

/// `hasDroppedFileData`.
fn has_dropped_file_data(message: &SessionMessageInfo) -> bool {
    let SessionMessageInfo::Assistant(assistant) = message else { return false };
    assistant
        .content
        .iter()
        .any(|part| matches!(part, SessionMessageAssistantContentItem::Tool(tool) if has_dropped_file(tool)))
}

fn omit_message_file_data(message: &mut SessionMessageInfo) {
    let SessionMessageInfo::Assistant(assistant) = message else { return };
    for part in &mut assistant.content {
        let SessionMessageAssistantContentItem::Tool(tool) = part else { continue };
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

impl State {
    pub fn messages(&self, session: &SessionID) -> &[SessionMessageInfo] {
        self.transcript(session).map(Transcript::items).unwrap_or_default()
    }

    pub fn transcript(&self, session: &SessionID) -> Option<&Transcript> {
        self.sessions.get(session)?.transcript.as_ref()
    }

    pub fn message(&self, session: &SessionID, message: &str) -> Option<&SessionMessageInfo> {
        self.transcript(session)?.get(message)
    }

    /// True while older pages remain (`message.more`).
    pub fn has_more_messages(&self, session: &SessionID) -> bool {
        self.sessions.get(session).is_some_and(|session| session.cursor.is_some())
    }

    /// The newest page of `session` is read, and no invalidation came after.
    pub fn messages_read(&self, session: &SessionID) -> bool {
        let read = crate::reads::Read::Session(session.as_str(), crate::reads::SessionRead::Messages);
        matches!(self.read_state(read), Some(crate::reads::ReadState::Done))
    }

    pub fn messages_loading(&self, session: &SessionID) -> bool {
        self.sessions.get(session).is_some_and(|session| session.loading)
    }

    pub(crate) fn stored(&self, mut message: SessionMessageInfo) -> SessionMessageInfo {
        if self.omit_file_data {
            omit_message_file_data(&mut message);
        }
        message
    }

    /// The transcript of `session`, created empty when missing (`draft[sessionID] ??= []`).
    pub(crate) fn transcript_mut(&mut self, session: &SessionID) -> &mut Transcript {
        self.sessions.get_or_insert(session).transcript.get_or_insert_default()
    }

    /// Appends `item` unless present (`message.insert`).
    pub(crate) fn insert_message(&mut self, session: &SessionID, item: SessionMessageInfo) {
        // A session the store found missing shows nothing, whatever arrives late (model O9).
        if self.is_missing(session) {
            return;
        }
        let key = self.sessions.entry(session);
        let record = &mut self.sessions[key];
        let transcript = record.transcript.get_or_insert_default();
        if !transcript.append(item) {
            return;
        }
        if let Some(read) = &mut record.head_read
            && let Some(item) = transcript.items().last()
        {
            read.record_created(self.event_seq, item.id());
        }
        self.touch_key(key, Touched::SHAPE);
    }

    pub(crate) fn upsert_message(&mut self, session: &SessionID, item: SessionMessageInfo) {
        let id = SessionMessageID(item.id().to_owned());
        let transcript = self.transcript_mut(session);
        if transcript.contains(&id.0) {
            transcript.upsert(item);
            self.message_changed(session, &id);
            return;
        }
        transcript.append(item);
        self.touch(session, Touched::SHAPE);
    }

    /// Records a row the current event created, with its `durable.seq`, for the head read in flight.
    pub(crate) fn created(&mut self, session: &SessionID, id: &str) {
        if let Some(read) = self.sessions.get_mut(session).and_then(|session| session.head_read.as_mut()) {
            read.record_created(self.event_seq, id);
        }
    }

    /// Records a durable edit for the head read of its session in flight, to replay onto the page.
    pub(crate) fn record_edit(&mut self, event: &V2Event) {
        let Some(read) = edit_session(event)
            .and_then(|session| self.sessions.get_mut(session))
            .and_then(|session| session.head_read.as_mut())
        else {
            return;
        };
        if read.room() {
            read.edits.push(event.clone());
        }
    }

    /// The head read `head`, while it is still the active read of its transcript window.
    fn live_head(&self, head: &Head) -> Option<&HeadRead> {
        let record = self.sessions.get(&head.session)?;
        if record.incarnation != head.incarnation {
            return None;
        }
        record.head_read.as_ref().filter(|read| read.ticket == head.read)
    }

    /// Loaded messages that are where the server placed them, oldest first: empty when the transcript is not
    /// anchored or `read` overflowed, and excluding pending/outbox inputs (which sit where they were admitted until
    /// delivered) and rows events created during `read` (which `publish_head` places by `durable.seq`).
    fn history_for_head(&self, session: &SessionID, read: &HeadRead) -> Vec<&SessionMessageInfo> {
        let Some(record) = self.sessions.get(session) else { return Vec::new() };
        if read.overflowed {
            return Vec::new();
        }
        let Some(transcript) = &record.transcript else { return Vec::new() };
        let items = match record.anchored {
            Anchor::None => return Vec::new(),
            Anchor::Live => transcript.items(),
            Anchor::Prefix(n) => &transcript.items()[..n.min(transcript.items().len())],
        };
        let pending: HashSet<&str> = self.inputs(session).into_iter().collect();
        let created: HashSet<&str> = read.created.iter().map(|(id, _)| id.as_str()).collect();
        items
            .iter()
            .filter(|item| {
                let id = item.id();
                !self.outbox.contains(id) && !pending.contains(id) && !created.contains(id)
            })
            .collect()
    }

    /// The oldest loaded history ID when `first` does not fall inside it (`apart`, history half), or `None` when
    /// `head` ended, has no anchored history, or already meets it.
    pub(crate) fn head_gap(&self, head: &Head, first: &str) -> Option<String> {
        let read = self.live_head(head)?;
        let history = self.history_for_head(&head.session, read);
        let oldest = history.first()?.id();
        (!history.iter().any(|item| item.id() == first)).then(|| oldest.to_owned())
    }

    /// Loaded messages older than `first` that are still running and must be read again while `head` is live.
    pub(crate) fn head_unsettled(&self, head: &Head, first: &str) -> Vec<SessionMessageID> {
        let Some(read) = self.live_head(head) else { return Vec::new() };
        let history = self.history_for_head(&head.session, read);
        let Some(at) = history.iter().position(|item| item.id() == first) else { return Vec::new() };
        history[..at].iter().filter(|item| unsettled(item)).map(|item| SessionMessageID(item.id().to_owned())).collect()
    }

    /// Publishes the head pages of a transcript (models M2); true when the order of what overtook the read is unknown,
    /// so it must read again.
    ///
    /// When the fetched pages start inside the loaded anchored history, the loaded messages before them stay (with
    /// refreshed copies for any that were still running) along with their cursor; otherwise the fetched pages replace
    /// the transcript. A row an event created during the read that the pages lack is placed by its `durable.seq`
    /// against a page row also created during the read: higher means newer than the page, so it is appended; lower
    /// means older than the page, so it is dropped, and an older page brings it back. Without such a page row (and
    /// with older rows on the server) the order is unknown: the transcript is published without it and read again.
    /// Message IDs never decide the order. A page row created during the read keeps its local copy; the durable edits
    /// that overtook the read then replay onto the rest. Each sets a whole value, so a replay the page holds changes
    /// nothing.
    fn publish_head(&mut self, session: &SessionID, read: HeadRead, pages: HeadPages) -> bool {
        let seq = |id: &str| read.created.iter().find(|(created, _)| created == id).map(|(_, seq)| *seq);
        // The stream saw the whole life of a row it created during the read, deltas included.
        let mut seen_fetched = HashSet::new();
        let mut fetched: Vec<_> = pages
            .data
            .into_iter()
            .filter(|item| seen_fetched.insert(item.id().to_owned()))
            .map(|item| match seq(item.id()).and_then(|_| self.message(session, item.id())) {
                Some(local) => local.clone(),
                None => self.stored(item),
            })
            .collect();
        fetched.reverse();
        let ids: HashSet<String> = fetched.iter().map(|item| item.id().to_owned()).collect();
        // The pages the reader loaded stay when the fetched messages start inside them: the messages before that point
        // cannot have been removed, since a revert removes from its boundary to the end.
        let prefix: Option<Vec<SessionMessageInfo>> = fetched.first().and_then(|first| {
            let history = self.history_for_head(session, &read);
            let at = history.iter().position(|item| item.id() == first.id())?;
            if history[..at].iter().any(|item| ids.contains(item.id())) {
                return None;
            }
            Some(
                history[..at]
                    .iter()
                    .map(|item| match pages.refreshed.get(item.id()) {
                        Some(refreshed) => self.stored(refreshed.clone()),
                        None => (*item).clone(),
                    })
                    .collect(),
            )
        });
        // Kept pages keep the cursor to the page before them. When `fetched` starts at the first loaded message
        // (`prefix` is empty) and the server reports no older pages, drop the old cursor too.
        let next = match (&prefix, &pages.next) {
            (Some(_), Some(_)) => self.sessions.get(session).and_then(|record| record.cursor.clone()),
            (Some(kept), None) if !kept.is_empty() => {
                self.sessions.get(session).and_then(|record| record.cursor.clone())
            }
            _ => pages.next,
        };
        let mut kept = ids.clone();
        if let Some(prefix) = &prefix {
            kept.extend(prefix.iter().map(|item| item.id().to_owned()));
        }
        let anchor = fetched.iter().filter_map(|item| seq(item.id())).min();
        let mut streamed: Vec<&(String, i64)> = read.created.iter().filter(|(id, _)| !kept.contains(id)).collect();
        let unknown = read.overflowed || (next.is_some() && anchor.is_none() && !streamed.is_empty());
        streamed.sort_by_key(|(_, seq)| *seq);
        let streamed: Vec<_> = streamed
            .into_iter()
            .filter(|(id, seq)| !unknown && (next.is_none() || Some(*seq) > anchor) && kept.insert(id.clone()))
            .filter_map(|(id, _)| self.message(session, id).cloned())
            .collect();
        // A read racing an admission must not wipe its local transcript row.
        let admitted: HashSet<&str> = self
            .pending(session)
            .iter()
            .filter(|item| matches!(item, SessionInboxInfo::User(_) | SessionInboxInfo::Synthetic(_)))
            .map(|item| item.id())
            .collect();
        let local: Vec<_> = self
            .messages(session)
            .iter()
            .filter(|item| {
                (self.outbox.contains(item.id()) || admitted.contains(item.id())) && kept.insert(item.id().to_owned())
            })
            .cloned()
            .collect();
        // The transcript only holds delivered input, so a pending row it contains missed its
        // inbox.delivered event (and maybe its enqueued echo) while the event stream was down.
        let delivered: Vec<String> =
            admitted.iter().filter(|id| ids.contains(**id)).map(|id| (*id).to_owned()).collect();
        let mut messages = prefix.unwrap_or_default();
        messages.extend(fetched);
        messages.extend(streamed);
        messages.extend(local);
        for id in &delivered {
            self.outbox.remove(id);
            self.remove_pending(session, id);
        }
        let key = self.sessions.entry(session);
        let record = &mut self.sessions[key];
        record.anchored = if unknown { Anchor::Prefix(messages.len()) } else { Anchor::Live };
        let paged = record.cursor.is_some() == next.is_some();
        record.cursor = next;
        // Like TS `reconcile`: the same IDs in the same order only update the changed messages.
        let current = record.transcript.as_mut().filter(|transcript| {
            paged
                && transcript.items().iter().map(SessionMessageInfo::id).eq(messages.iter().map(SessionMessageInfo::id))
        });
        match current {
            None => {
                record.transcript.get_or_insert_default().replace(messages);
                self.touch_key(key, Touched::SHAPE);
            }
            Some(transcript) => {
                let mut changed = false;
                for (position, message) in messages.into_iter().enumerate() {
                    if transcript.items()[position] != message {
                        self.log.message(key, transcript.keys()[position]);
                        transcript.items_mut()[position] = message;
                        changed = true;
                    }
                }
                if changed {
                    self.touch_key(key, Touched::CONTENT);
                }
            }
        }
        // A replayed edit already asked for what it reads when it arrived.
        let mut ignored = Vec::new();
        for event in &read.edits {
            self.apply(event, &mut ignored);
        }
        unknown
    }

    /// Edits one loaded assistant message; drops the edit when it is not loaded (`editAssistant`).
    pub(crate) fn edit_assistant(
        &mut self,
        session: &(impl AsRef<str> + ?Sized),
        message: &(impl AsRef<str> + ?Sized),
        f: impl FnOnce(&mut SessionMessageAssistant),
    ) {
        let Some((key, position)) = self.edited(session.as_ref(), message.as_ref()) else { return };
        let Some(transcript) = &mut self.sessions[key].transcript else { return };
        let SessionMessageInfo::Assistant(assistant) = &mut transcript.items_mut()[position] else { return };
        f(assistant);
        let message = transcript.keys()[position];
        self.touch_message(key, message);
    }

    /// Where `message` of `session` is. A run of deltas edits one message, so the last place found is checked first:
    /// two ID comparisons in place of two hashes.
    fn edited(&mut self, session: &str, message: &str) -> Option<(SessionKey, usize)> {
        if let Some((key, position)) = self.last_edited
            && let Some(record) = self.sessions.live(key)
            && record.id.as_str() == session
            && record.transcript.as_ref()?.items().get(position).is_some_and(|item| item.id() == message)
        {
            return Some((key, position));
        }
        let key = self.sessions.key(session)?;
        let transcript = self.sessions[key].transcript.as_ref()?;
        let position = transcript.position(transcript.key(message)?)?;
        self.last_edited = Some((key, position));
        Some((key, position))
    }

    /// Edits the latest tool part with `tool` (`editTool`).
    fn edit_tool(
        &mut self,
        session: &(impl AsRef<str> + ?Sized),
        message: &(impl AsRef<str> + ?Sized),
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
        session: &(impl AsRef<str> + ?Sized),
        message: &(impl AsRef<str> + ?Sized),
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
        session: &(impl AsRef<str> + ?Sized),
        message: &(impl AsRef<str> + ?Sized),
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
        if self.is_missing(session) {
            return;
        }
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
            existing.time.first_token = None;
            existing.time.streamed = None;
            existing.time.completed = None;
            if let Some(snapshot) = &data.snapshot {
                existing.snapshot.get_or_insert_default().start = Some(snapshot.clone());
            }
            self.message_changed(session, &data.assistant_message_id);
            return;
        }
        if let Some(current) = transcript.active_assistant() {
            current.retry = None;
            current.time.completed = Some(event.created);
            let id = current.id.clone();
            self.message_changed(session, &id);
        }
        let assistant = SessionMessageAssistant {
            id: data.assistant_message_id.clone(),
            r#type: tag::Assistant,
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

    pub(crate) fn on_step_first_token(&mut self, event: &SessionStepFirstToken) {
        let created = event.created;
        self.edit_assistant(&event.data.session_id, &event.data.assistant_message_id, |assistant| {
            assistant.time.first_token = Some(created)
        });
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

    /// A start the snapshot already holds (its `ordinal` counts the message's text parts) is skipped, so a replay
    /// over a fresh page does not show the part twice.
    pub(crate) fn on_text_started(&mut self, session: &SessionID, message: &SessionMessageID, ordinal: i64) {
        self.edit_assistant(session, message, |assistant| {
            let held = assistant
                .content
                .iter()
                .filter(|part| matches!(part, SessionMessageAssistantContentItem::Text(_)))
                .count();
            if held as i64 > ordinal {
                return;
            }
            assistant.content.push(SessionMessageAssistantContentItem::Text(SessionMessageAssistantText {
                r#type: tag::Text,
                ..Default::default()
            }));
        });
    }

    pub(crate) fn on_text_ended(&mut self, data: &SessionTextEndedData) {
        self.edit_text(&data.session_id, &data.assistant_message_id, |text| text.text.clone_from(&data.text));
    }

    pub(crate) fn on_reasoning_started(&mut self, event: &SessionReasoningStarted) {
        let data = &event.data;
        self.edit_assistant(&data.session_id, &data.assistant_message_id, |assistant| {
            let held = assistant
                .content
                .iter()
                .filter(|part| matches!(part, SessionMessageAssistantContentItem::Reasoning(_)))
                .count();
            if held as i64 > data.ordinal {
                return;
            }
            assistant.content.push(SessionMessageAssistantContentItem::Reasoning(SessionMessageAssistantReasoning {
                r#type: tag::Reasoning,
                text: String::new(),
                native: data.native.clone(),
                time: Some(SessionMessageShellTime { created: event.created, completed: None }),
            }));
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
            if assistant
                .content
                .iter()
                .any(|part| matches!(part, SessionMessageAssistantContentItem::Tool(tool) if tool.id == data.id))
            {
                return;
            }
            assistant.content.push(SessionMessageAssistantContentItem::Tool(SessionMessageAssistantTool {
                r#type: tag::Tool,
                id: data.id.clone(),
                name: data.name.clone(),
                executed: None,
                native: None,
                time: SessionMessageAssistantToolTime { created: event.created, ..Default::default() },
                state: SessionMessageAssistantToolState::Streaming(SessionMessageToolStateStreaming {
                    status: tag::Streaming,
                    input: String::new(),
                }),
            }));
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
                status: tag::Running,
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
            let SessionMessageAssistantToolState::Running(state) = &tool.state else { return };
            let mut content = data.content.clone();
            if omit {
                omit_file_data(&mut content);
            }
            tool.state = SessionMessageAssistantToolState::Completed(SessionMessageToolStateCompleted {
                status: tag::Completed,
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
                status: tag::Error,
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
        let Some(current) = self.transcript_mut(session).active_assistant() else { return };
        if current.retry.take().is_some() {
            let id = current.id.clone();
            self.message_changed(session, &id);
        }
    }

    /// True when a loaded assistant message still has a streaming or running tool.
    pub(crate) fn has_live_tool(&self, session: &SessionID) -> bool {
        self.messages(session).iter().any(|item| {
            let SessionMessageInfo::Assistant(assistant) = item else { return false };
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
            r#type: tag::Shell,
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
        let Some(transcript) = self.sessions.get_mut(session).and_then(|session| session.transcript.as_mut()) else {
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
        self.message_changed(session, &id);
    }

    /// `session.revert.committed`: drops messages at or after the boundary.
    pub(crate) fn revert_messages(&mut self, session: &SessionID, to: &SessionMessageID) {
        let key = self.sessions.entry(session);
        let record = &mut self.sessions[key];
        let transcript = record.transcript.get_or_insert_default();
        let Some(position) = transcript.items().iter().position(|item| item.id() >= to.as_str()) else { return };
        transcript.truncate(position);
        if let Anchor::Prefix(n) = &mut record.anchored {
            *n = (*n).min(position);
        }
        self.touch_key(key, Touched::SHAPE);
    }

    /// Applies a streaming delta: it appends to the part it names.
    pub(crate) fn apply_delta(&mut self, delta: Delta<'_>) {
        self.event_seq = None;
        match delta {
            Delta::Text { session, message, delta } => {
                self.edit_text(session, message, |text| text.text.push_str(delta))
            }
            Delta::Reasoning { session, message, delta } => {
                self.edit_reasoning(session, message, |reasoning| reasoning.text.push_str(delta))
            }
            Delta::ToolInput { session, message, tool, delta } => self.edit_tool(session, message, tool, |tool| {
                if let SessionMessageAssistantToolState::Streaming(state) = &mut tool.state {
                    state.input.push_str(delta);
                }
            }),
            Delta::Compaction { session, text } => self.on_compaction_delta(session, text),
        }
    }

    fn on_compaction_delta(&mut self, session: &str, text: &str) {
        let Some(transcript) = self.sessions.get_mut(session).and_then(|session| session.transcript.as_mut()) else {
            return;
        };
        let Some(running) = running_compaction(transcript) else { return };
        let SessionMessageInfo::Compaction(SessionMessageCompaction::Running(current)) =
            &mut transcript.items_mut()[running]
        else {
            return;
        };
        current.summary.push_str(text);
        let id = current.id.clone();
        self.message_changed(session, &id);
    }

    pub(crate) fn on_compaction_ended(&mut self, event: &SessionCompactionEnded) {
        let data = &event.data;
        let session = &data.session_id;
        let transcript = self.transcript_mut(session);
        let completed = |id: SessionMessageID, metadata, time| {
            SessionMessageInfo::Compaction(SessionMessageCompaction::Completed(SessionMessageCompactionCompleted {
                r#type: tag::Compaction,
                id,
                metadata,
                time,
                status: tag::Completed,
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
            self.message_changed(session, &id);
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
                r#type: tag::Compaction,
                id,
                metadata,
                time,
                status: tag::Failed,
                reason: data.reason.clone(),
                error: data.error.clone(),
                cost: data.cost,
                tokens: data.tokens.clone(),
            }))
        };
        if let Some((position, current)) = running {
            transcript.items_mut()[position] = failed(current.id.clone(), current.metadata, current.time);
            self.message_changed(session, &current.id);
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

/// What overtook one head read of a transcript (models M2): the rows events created, each with its event's
/// `durable.seq`, and the durable edits in arrival order. Past [`OVERLAY_LIMIT`] records it overflows: the read then
/// publishes its page alone and reads again.
#[derive(Default)]
pub(crate) struct HeadRead {
    ticket: u64,
    created: Vec<(String, i64)>,
    edits: Vec<V2Event>,
    overflowed: bool,
}

impl HeadRead {
    /// Ends the read `ticket` of `session`: its records, while that read is still the current one.
    fn take(state: &mut State, session: &SessionID, ticket: u64) -> Option<Self> {
        state.sessions.get_mut(session)?.head_read.take_if(|read| read.ticket == ticket)
    }

    /// Records a row the event being applied created, with its `durable.seq`.
    fn record_created(&mut self, seq: Option<i64>, id: &str) {
        let Some(seq) = seq else { return };
        if self.room() {
            self.created.push((id.to_owned(), seq));
        }
    }

    /// False once overflowed; it then records nothing more.
    fn room(&mut self) -> bool {
        if !self.overflowed && self.created.len() + self.edits.len() >= OVERLAY_LIMIT {
            self.overflowed = true;
            self.created = Vec::new();
            self.edits = Vec::new();
        }
        !self.overflowed
    }
}

/// The session of a durable edit that only changes rows by ID, so replaying it onto a page is safe.
fn edit_session(event: &V2Event) -> Option<&SessionID> {
    Some(match event {
        V2Event::SessionShellEnded(event) => &event.data.session_id,
        V2Event::SessionStepFirstToken(event) => &event.data.session_id,
        V2Event::SessionStepStreamed(event) => &event.data.session_id,
        V2Event::SessionStepEnded(event) => &event.data.session_id,
        V2Event::SessionStepFailed(event) => &event.data.session_id,
        V2Event::SessionTextStarted(event) => &event.data.session_id,
        V2Event::SessionTextEnded(event) => &event.data.session_id,
        V2Event::SessionReasoningStarted(event) => &event.data.session_id,
        V2Event::SessionReasoningEnded(event) => &event.data.session_id,
        V2Event::SessionToolInputStarted(event) => &event.data.session_id,
        V2Event::SessionToolInputEnded(event) => &event.data.session_id,
        V2Event::SessionToolCalled(event) => &event.data.session_id,
        V2Event::SessionToolSuccess(event) => &event.data.session_id,
        V2Event::SessionToolFailed(event) => &event.data.session_id,
        V2Event::SessionRetryScheduled(event) => &event.data.session_id,
        _ => return None,
    })
}

impl State {
    /// Begins a read of the newest transcript page of the session of `ticket`, opening a log of what overtakes it.
    pub(crate) fn begin_messages(&mut self, ticket: Ticket) -> Head {
        let read = self.token();
        let record = &mut self.sessions[ticket.session()];
        record.head_read = Some(HeadRead { ticket: read, ..HeadRead::default() });
        Head { ticket, session: record.id.clone(), read, incarnation: record.incarnation }
    }

    /// Publishes the newest transcript page read `read` fetched, unless deletion or eviction dropped the read. A
    /// revert ends the window under it, and an order [`State::publish_head`] cannot know, read it again.
    pub(crate) fn complete_messages(
        &mut self,
        head: Head,
        result: Result<HeadPages, Error>,
        effects: &mut Vec<Effect>,
    ) {
        let session = &head.session;
        let read = HeadRead::take(self, session, head.read);
        let pages = match result {
            Ok(pages) => pages,
            Err(error) => return self.evict_missing(&error),
        };
        let Some(read) = read else { return };
        let reread = self.incarnation(session) != head.incarnation || self.publish_head(session, read, pages);
        if reread {
            self.invalidate_key(head.ticket.key);
            effects.push(Effect::Messages(head.session));
        }
    }

    /// Upserts one projected message (the `session.model.selected` read), unless a head read dropped the row as older
    /// than its page or the transcript window it was asked in ended (deviation O6-held-message-read).
    pub(crate) fn complete_message(&mut self, session: &SessionID, incarnation: u64, item: SessionMessageInfo) {
        if self.incarnation(session) != incarnation || self.message(session, item.id()).is_none() {
            return;
        }
        let item = self.stored(item);
        self.upsert_message(session, item);
    }

    /// The loaded messages whose tool file data was dropped, by session, for a client that starts showing tool files.
    pub(crate) fn dropped_files(&self) -> Vec<(SessionID, Vec<SessionMessageID>)> {
        self.sessions
            .iter()
            .filter_map(|session| {
                let ids: Vec<_> = session
                    .transcript
                    .as_ref()?
                    .items()
                    .iter()
                    .filter(|message| has_dropped_file_data(message))
                    .map(|message| SessionMessageID(message.id().to_owned()))
                    .collect();
                (!ids.is_empty()).then(|| (session.id.clone(), ids))
            })
            .collect()
    }

    /// Copies back only the emptied tool files of a message read again: live events may have moved the message on
    /// since the server read it.
    pub(crate) fn restore_files(&mut self, session: &SessionID, message: &SessionMessageID, item: SessionMessageInfo) {
        let SessionMessageInfo::Assistant(fetched) = item else { return };
        if self.omit_file_data {
            return;
        }
        self.edit_assistant(session, message, |assistant| {
            for part in &mut assistant.content {
                let SessionMessageAssistantContentItem::Tool(tool) = part else { continue };
                if !has_dropped_file(tool) {
                    continue;
                }
                let content = fetched.content.iter().rev().find_map(|other| match other {
                    SessionMessageAssistantContentItem::Tool(other) if other.id == tool.id => Some(other),
                    _ => None,
                });
                let Some(content) = content.and_then(tool_content) else { continue };
                match &mut tool.state {
                    SessionMessageAssistantToolState::Completed(state) => state.content = content.to_vec(),
                    SessionMessageAssistantToolState::Error(state) => state.content = Some(content.to_vec()),
                    _ => {}
                }
            }
        });
    }

    /// Begins an older-page load of `session` from its cursor, if any, registering it for joiners.
    pub(crate) fn begin_older(&mut self, session: &SessionID) -> Option<(u64, Page)> {
        let key = self.sessions.key(session)?;
        let cursor = self.sessions[key].cursor.clone()?;
        let token = self.token();
        let record = &mut self.sessions[key];
        // No view reads `messages_loading` (the transcript keeps its own flag), so it logs no change.
        record.loading = true;
        record.message_load = Some(token);
        Some((token, Page { cursor, incarnation: record.incarnation }))
    }

    /// Where a load that read from `page` goes on: `None` while `page` is current, so its pages publish; else from
    /// the cursor a refresh left, `Some(None)` when none is left.
    pub(crate) fn page_moved(&self, session: &SessionID, page: &Page) -> Option<Option<Page>> {
        let current = self.sessions.get(session).and_then(|session| session.cursor.as_ref());
        let incarnation = self.incarnation(session);
        if current == Some(&page.cursor) && incarnation == page.incarnation {
            return None;
        }
        Some(current.map(|cursor| Page { cursor: cursor.clone(), incarnation }))
    }

    /// Publishes older pages read from `page`, oldest last in `fetched`, while `page` is current.
    pub(crate) fn complete_older(
        &mut self,
        session: &SessionID,
        page: &Page,
        fetched: Vec<SessionMessageInfo>,
        next: Option<String>,
    ) {
        if self.page_moved(session, page).is_some() {
            return;
        }
        let fetched: Vec<_> = fetched.into_iter().map(|item| self.stored(item)).collect();
        let record = self.sessions.get_or_insert(session);
        let transcript = record.transcript.get_or_insert_default();
        let older: Vec<_> = fetched.into_iter().rev().filter(|item| !transcript.contains(item.id())).collect();
        let added = older.len();
        transcript.prepend(older);
        if let Anchor::Prefix(n) = &mut record.anchored {
            *n += added;
        }
        record.cursor = next;
        self.touch(session, Touched::SHAPE);
    }

    /// Ends the older-page load `token` of `session`.
    pub(crate) fn end_older(&mut self, session: &SessionID, token: u64) {
        let Some(session) = self.sessions.get_mut(session) else { return };
        session.loading = false;
        session.message_load.take_if(|current| *current == token);
    }
}

/// Where an older-page load reads from: a cursor of the transcript window it began in.
#[derive(Debug, Clone)]
pub(crate) struct Page {
    pub(crate) cursor: String,
    pub(crate) incarnation: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(id: &str) -> SessionMessageInfo {
        serde_json::from_value(serde_json::json!({ "id": id, "type": "user", "text": "", "time": { "created": 1 } }))
            .unwrap()
    }

    /// A message keeps its key while it stays, also through a reload of its page, so its rows stay; a key that left
    /// is never given to another message.
    #[test]
    fn keys_follow_their_messages() {
        let mut transcript = Transcript::default();
        for id in ["a", "b", "c"] {
            transcript.append(message(id));
        }
        let [a, b, c] = ["a", "b", "c"].map(|id| transcript.key(id).unwrap());
        transcript.remove("a");
        transcript.prepend(vec![message("z")]);
        let z = transcript.key("z").unwrap();
        transcript.replace(vec![message("b"), message("d"), message("c")]);
        assert_eq!((transcript.key("b"), transcript.key("c")), (Some(b), Some(c)));
        let d = transcript.key("d").unwrap();
        assert!(![a, b, c, z].contains(&d));
        assert_eq!((transcript.position(a), transcript.position(z)), (None, None));
        for (position, key) in transcript.keys().iter().enumerate() {
            assert_eq!(transcript.position(*key), Some(position));
        }
    }
}
