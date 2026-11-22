//! What the store changed since its one consumer last took it ([`crate::Data::take_changes`]): keys of the sessions
//! and messages touched, recorded without allocating once the buffers are warm. The consumer swaps its own [`Dirty`]
//! in, so the buffers go back and forth.

use std::ops::BitOr;

use opencode_api::generated::{AgentID, ModelRef, SessionID};

use crate::forms::GLOBAL;
use crate::location::Location;
use crate::messages::MessageKey;
use crate::reads::LocationKey;
use crate::sessions::{Session, SessionKey};
use crate::state::{Data, State};

/// A session's agent and model.
pub type Selected = (Option<AgentID>, Option<ModelRef>);

/// Content changes kept before the consumer gets [`Changes::all`] instead.
const MESSAGE_LIMIT: usize = 4096;

/// What changed of one session.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Touched(u16);

impl Touched {
    pub const INFO: Self = Self(1);
    pub const STATUS: Self = Self(1 << 1);
    /// The message list changed shape: insert, remove, reorder, reload, page.
    pub const SHAPE: Self = Self(1 << 2);
    /// A message changed in place (a delta, a tool update).
    pub const CONTENT: Self = Self(1 << 3);
    pub const PENDING: Self = Self(1 << 4);
    pub const PERMISSIONS: Self = Self(1 << 5);
    pub const FORMS: Self = Self(1 << 6);
    /// Running jobs: of their owner, and of the child a subagent job runs.
    pub const JOBS: Self = Self(1 << 7);
    /// An agent or model was selected.
    pub const SELECTED: Self = Self(1 << 8);

    pub fn any(self, other: Self) -> bool {
        self.0 & other.0 != 0
    }
}

impl BitOr for Touched {
    type Output = Self;

    fn bitor(self, other: Self) -> Self {
        Self(self.0 | other.0)
    }
}

/// The changes of one or more flushes.
#[derive(Debug, Default)]
pub struct Dirty {
    /// Everything may have changed: a reconnect, or more changes than are kept.
    all: bool,
    /// Session list membership or order (any session info change).
    sessions: bool,
    /// Projects or saved permissions changed.
    projects: bool,
    /// The forms of [`GLOBAL`] changed.
    global_forms: bool,
    /// Each touched session once. Its record holds its place here while the store owns this.
    touched: Vec<(SessionKey, Touched)>,
    /// Messages changed in place, by their transcript's message key.
    messages: Vec<(SessionKey, MessageKey)>,
    /// Each agent or model selection, in order: a batch can hold this client's acknowledgment and then another
    /// client's switch.
    selected: Vec<(SessionKey, Selected)>,
    /// Locations whose info, catalogs, or shells changed.
    locations: Vec<LocationKey>,
}

static EVERYTHING: Dirty = Dirty::new(true);
static NOTHING: Dirty = Dirty::new(false);

impl Dirty {
    const fn new(all: bool) -> Self {
        Self {
            all,
            sessions: false,
            projects: false,
            global_forms: false,
            touched: Vec::new(),
            messages: Vec::new(),
            selected: Vec::new(),
            locations: Vec::new(),
        }
    }

    pub fn is_empty(&self) -> bool {
        !self.all
            && !self.sessions
            && !self.projects
            && !self.global_forms
            && self.touched.is_empty()
            && self.selected.is_empty()
            && self.locations.is_empty()
    }

    /// Empties it, keeping the buffers.
    fn clear(&mut self) {
        (self.all, self.sessions, self.projects, self.global_forms) = (false, false, false, false);
        self.touched.clear();
        self.messages.clear();
        self.selected.clear();
        self.locations.clear();
    }

    fn touched(&self, key: Option<SessionKey>) -> Touched {
        let Some(key) = key else { return Touched::default() };
        self.touched.iter().find(|(touched, _)| *touched == key).map_or(Touched::default(), |(_, bits)| *bits)
    }
}

/// The changes the store records until the consumer takes them, and the revision of the last flush.
#[derive(Debug, Default)]
pub(crate) struct Log {
    revision: u64,
    /// Something changed since the last flush.
    unflushed: bool,
    dirty: Dirty,
}

impl Log {
    pub(crate) fn revision(&self) -> u64 {
        self.revision
    }

    /// Numbers the changes since the last flush; the new revision, or none when nothing changed.
    pub(crate) fn flush(&mut self) -> Option<u64> {
        if !std::mem::take(&mut self.unflushed) {
            return None;
        }
        self.revision += 1;
        Some(self.revision)
    }

    /// Swaps the changes into `into` and unmarks their records.
    pub(crate) fn take(&mut self, sessions: &mut crate::sessions::Sessions, into: &mut Dirty) {
        into.clear();
        std::mem::swap(&mut self.dirty, into);
        for (key, _) in &into.touched {
            if let Some(session) = sessions.live_mut(*key) {
                session.dirty = 0;
            }
        }
    }

    pub(crate) fn touch(&mut self, session: &mut Session, key: SessionKey, bits: Touched) {
        self.unflushed = true;
        if bits.any(Touched::INFO) {
            self.dirty.sessions = true;
        }
        if session.dirty == 0 {
            self.dirty.touched.push((key, bits));
            session.dirty = self.dirty.touched.len() as u32;
            return;
        }
        let touched = &mut self.dirty.touched[session.dirty as usize - 1].1;
        *touched = *touched | bits;
    }

    /// Records message `message` of the session `key` as changed in place; the session must be touched.
    pub(crate) fn message(&mut self, key: SessionKey, message: MessageKey) {
        let dirty = &mut self.dirty;
        if dirty.all || dirty.messages.contains(&(key, message)) {
            return;
        }
        if dirty.messages.len() == MESSAGE_LIMIT {
            dirty.all = true;
            return;
        }
        dirty.messages.push((key, message));
    }

    pub(crate) fn projects(&mut self) {
        self.unflushed = true;
        self.dirty.projects = true;
    }

    /// Everything may have changed (a reconnect): every view looks again.
    pub(crate) fn everything(&mut self) {
        self.unflushed = true;
        self.dirty.all = true;
    }
}

/// [`Dirty`] as the views ask about it, by ID. Each answer reads the store briefly, so no lock is held between them.
#[derive(Clone, Copy)]
pub struct Changes<'a> {
    dirty: &'a Dirty,
    data: &'a Data,
}

impl<'a> Changes<'a> {
    pub fn new(dirty: &'a Dirty, data: &'a Data) -> Self {
        Self { dirty, data }
    }

    /// Everything may have changed.
    pub fn everything(data: &'a Data) -> Self {
        Self { dirty: &EVERYTHING, data }
    }

    pub fn nothing(data: &'a Data) -> Self {
        Self { dirty: &NOTHING, data }
    }

    pub fn is_empty(&self) -> bool {
        self.dirty.is_empty()
    }

    /// Everything may have changed: the views look again.
    pub fn all(&self) -> bool {
        self.dirty.all
    }

    pub fn sessions(&self) -> bool {
        self.dirty.all || self.dirty.sessions
    }

    /// Session `id` has any of `bits`; all of them when everything changed.
    pub fn has(&self, id: &(impl AsRef<str> + ?Sized), bits: Touched) -> bool {
        self.dirty.all || self.data.read(|state| self.dirty.touched(state.sessions.key(id)).any(bits))
    }

    /// Some session has any of `bits`.
    pub fn any(&self, bits: Touched) -> bool {
        self.dirty.all || self.dirty.touched.iter().any(|(_, touched)| touched.any(bits))
    }

    /// The forms of `owner`: a session ID or [`GLOBAL`].
    pub fn forms(&self, owner: &str) -> bool {
        match owner {
            GLOBAL => self.dirty.all || self.dirty.global_forms,
            _ => self.has(owner, Touched::FORMS),
        }
    }

    pub fn projects(&self) -> bool {
        self.dirty.all || self.dirty.projects
    }

    /// Some location changed: [`Changes::location`] says which.
    pub fn any_location(&self) -> bool {
        self.dirty.all || !self.dirty.locations.is_empty()
    }

    pub fn location(&self, location: &Location) -> bool {
        self.dirty.all
            || self.data.read(|state| {
                state.location_key(location).is_some_and(|location| self.dirty.locations.contains(&location))
            })
    }

    /// The sessions with any of `bits`, in the order first touched. Not everything: [`Changes::all`] says that.
    pub fn sessions_with<'s>(
        &self,
        state: &'s State,
        bits: Touched,
    ) -> impl Iterator<Item = &'s SessionID> + use<'s, 'a> {
        let dirty = self.dirty;
        dirty
            .touched
            .iter()
            .filter(move |(_, touched)| touched.any(bits))
            .filter_map(|(key, _)| state.sessions.live(*key).map(|session| &session.id))
    }

    /// The messages changed in place, by session and message ID.
    pub fn changed_messages<'s>(
        &self,
        state: &'s State,
    ) -> impl Iterator<Item = (&'s SessionID, &'s str)> + use<'s, 'a> {
        self.dirty.messages.iter().filter_map(|(key, message)| {
            let session = state.sessions.live(*key)?;
            Some((&session.id, session.transcript.as_ref()?.by_key(*message)?.id()))
        })
    }

    /// The keys of the messages of `session` changed in place.
    pub fn message_keys(&self, state: &State, session: &SessionID) -> impl Iterator<Item = MessageKey> + use<'a> {
        let key = state.sessions.key(session);
        self.dirty.messages.iter().filter(move |(touched, _)| Some(*touched) == key).map(|(_, message)| *message)
    }

    /// The agent and model selections of `id`, in order.
    pub fn selected<'s>(&self, state: &'s State, id: &SessionID) -> impl Iterator<Item = &'a Selected> + use<'s, 'a> {
        let key = state.sessions.key(id);
        self.dirty.selected.iter().filter(move |(selected, _)| Some(*selected) == key).map(|(_, selected)| selected)
    }

    pub fn locations<'s>(&self, state: &'s State) -> impl Iterator<Item = &'s Location> + use<'s, 'a> {
        self.dirty.locations.iter().filter_map(|location| state.location_at(*location))
    }
}

impl State {
    pub(crate) fn touch(&mut self, id: &(impl AsRef<str> + ?Sized), bits: Touched) {
        let key = self.sessions.entry(id);
        self.touch_key(key, bits);
    }

    pub(crate) fn touch_key(&mut self, key: SessionKey, bits: Touched) {
        self.log.touch(&mut self.sessions[key], key, bits);
    }

    /// Records message `message` of `session` as changed in place.
    pub(crate) fn message_changed(&mut self, session: &SessionID, message: &(impl AsRef<str> + ?Sized)) {
        let Some(key) = self.sessions.key(session) else { return };
        let transcript = self.sessions[key].transcript.as_ref();
        if let Some(message) = transcript.and_then(|transcript| transcript.key(message.as_ref())) {
            self.touch_message(key, message);
        }
    }

    /// Records message `message` of the session `key` as changed in place.
    pub(crate) fn touch_message(&mut self, key: SessionKey, message: MessageKey) {
        self.touch_key(key, Touched::CONTENT);
        self.log.message(key, message);
    }

    /// Records `id`'s agent and model as selected.
    pub(crate) fn touch_selected(&mut self, id: &SessionID) {
        let Some(info) = self.session(id) else { return };
        let selected = (info.agent.clone(), info.model.clone());
        let key = self.sessions.entry(id);
        self.touch_key(key, Touched::SELECTED);
        let dirty = &mut self.log.dirty;
        if dirty.selected.len() == MESSAGE_LIMIT {
            dirty.all = true;
            return;
        }
        dirty.selected.push((key, selected));
    }

    pub(crate) fn touch_location(&mut self, location: &Location) {
        let key = self.intern(location);
        self.log.unflushed = true;
        if !self.log.dirty.locations.contains(&key) {
            self.log.dirty.locations.push(key);
        }
    }

    pub(crate) fn take(&mut self, into: &mut Dirty) -> u64 {
        self.sessions.sweep();
        self.log.take(&mut self.sessions, into);
        self.log.revision()
    }

    /// The forms of `owner`: a session ID or [`GLOBAL`].
    pub(crate) fn touch_forms(&mut self, owner: &str) {
        match owner {
            GLOBAL => {
                self.log.unflushed = true;
                self.log.dirty.global_forms = true;
            }
            _ => self.touch(owner, Touched::FORMS),
        }
    }
}

impl Data {
    /// Hands what changed since the last take to the one consumer, in `into`, and returns the revision of the last
    /// flush. `into`'s earlier changes go: the consumer is done with them. The records the changes name stay marked
    /// until the take, so the sweep before it frees none the consumer reads.
    pub fn take_changes(&self, into: &mut Dirty) -> u64 {
        self.lock().take(into)
    }
}
