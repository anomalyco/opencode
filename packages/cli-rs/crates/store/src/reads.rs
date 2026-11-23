//! Keyed reads (`createSync`): one load per key, shared by every caller, read again once invalidated.

use std::ops::{Index, IndexMut};

use crate::location::{Catalog, Location};
use crate::sessions::SessionKey;
use crate::state::State;

/// Where a keyed read stands.
#[derive(Default)]
pub(crate) enum ReadState {
    /// Never read, or invalidated since.
    #[default]
    Idle,
    /// Read, until invalidated.
    Done,
    /// A load in flight, by token; every caller joins it.
    Loading { token: u64, phase: Phase },
}

/// What a caller of a keyed read does ([`State::start_read`]).
pub(crate) enum Start {
    /// Nothing: it is read.
    Done,
    /// Joins the load in flight with this token.
    Join(u64),
    /// Begins the load with this token now.
    Run(u64),
    /// Begins the load with the first token once the stale load with the second settles.
    After(u64, u64),
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Phase {
    /// A reload waiting for the stale load it replaces; it covers invalidations meanwhile.
    Queued,
    Running,
    /// Invalidated while running: it settles undone, and the next caller reads again.
    Stale,
}

impl ReadState {
    /// Read, or being read (`hasLocation`).
    pub(crate) fn has(&self) -> bool {
        !matches!(self, ReadState::Idle)
    }

    pub(crate) fn complete(&mut self) {
        if !self.has() {
            *self = ReadState::Done;
        }
    }

    pub(crate) fn invalidate(&mut self) {
        match self {
            ReadState::Done => *self = ReadState::Idle,
            ReadState::Loading { phase: phase @ Phase::Running, .. } => *phase = Phase::Stale,
            _ => {}
        }
    }

    /// Settles the load `token`: done when it succeeded and was not invalidated.
    pub(crate) fn settle(&mut self, token: u64, ok: bool) {
        let ReadState::Loading { token: current, phase, .. } = self else { return };
        if *current == token {
            *self = if ok && *phase != Phase::Stale { ReadState::Done } else { ReadState::Idle };
        }
    }
}

/// The reads of one session, in its record.
#[derive(Default)]
pub(crate) struct SessionReads([ReadState; 7]);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum SessionRead {
    Info,
    /// Info with every direct child.
    Family,
    Pending,
    /// The newest transcript page.
    Messages,
    Permissions,
    Forms,
    /// The running jobs of the tree under the session.
    Jobs,
}

impl SessionReads {
    pub(crate) fn is_idle(&self) -> bool {
        self.0.iter().all(|read| !read.has())
    }

    pub(crate) fn invalidate(&mut self) {
        self.0.iter_mut().for_each(ReadState::invalidate);
    }
}

impl Index<SessionRead> for SessionReads {
    type Output = ReadState;

    fn index(&self, read: SessionRead) -> &ReadState {
        &self.0[read as usize]
    }
}

impl IndexMut<SessionRead> for SessionReads {
    fn index_mut(&mut self, read: SessionRead) -> &mut ReadState {
        &mut self.0[read as usize]
    }
}

/// A location the store has read something of, by its place among them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct LocationKey(u32);

/// A keyed read. A session's reads live in its record; the rest in [`State`]'s map.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum ReadKey {
    Session(SessionKey, SessionRead),
    Location(LocationKey),
    Catalog(Catalog, LocationKey),
    /// The forms of [`crate::forms::GLOBAL`] at a location.
    GlobalForms(LocationKey),
    Projects,
}

/// A keyed read named by what it reads, for a caller without its key.
#[derive(Clone, Copy)]
pub(crate) enum Read<'a> {
    Session(&'a str, SessionRead),
    Location(&'a Location),
    Catalog(Catalog, &'a Location),
    GlobalForms(&'a Location),
    Projects,
}

impl State {
    /// The key of `read`, adding its session record or location when missing.
    pub(crate) fn read_key(&mut self, read: Read) -> ReadKey {
        match read {
            Read::Session(id, read) => ReadKey::Session(self.sessions.entry(id), read),
            Read::Location(at) => ReadKey::Location(self.intern(at)),
            Read::Catalog(catalog, at) => ReadKey::Catalog(catalog, self.intern(at)),
            Read::GlobalForms(at) => ReadKey::GlobalForms(self.intern(at)),
            Read::Projects => ReadKey::Projects,
        }
    }

    /// The key of `location`, added when missing.
    pub(crate) fn intern(&mut self, location: &Location) -> LocationKey {
        match self.read_locations.get_index_of(location) {
            Some(index) => LocationKey(index as u32),
            None => LocationKey(self.read_locations.insert_full(location.clone()).0 as u32),
        }
    }

    /// The key of `location`, when a read or a change named it.
    pub(crate) fn location_key(&self, location: &Location) -> Option<LocationKey> {
        self.read_locations.get_index_of(location).map(|at| LocationKey(at as u32))
    }

    pub(crate) fn location_at(&self, key: LocationKey) -> Option<&Location> {
        self.read_locations.get_index(key.0 as usize)
    }

    /// The location of a read's key: interned locations stay.
    pub(crate) fn read_location(&self, key: LocationKey) -> Location {
        self.location_at(key).expect("an interned location").clone()
    }

    /// The key of `read`, while anything of it is kept.
    fn find_key(&self, read: Read) -> Option<ReadKey> {
        let location = |location| self.location_key(location);
        Some(match read {
            Read::Session(id, read) => ReadKey::Session(self.sessions.key(id)?, read),
            Read::Location(at) => ReadKey::Location(location(at)?),
            Read::Catalog(catalog, at) => ReadKey::Catalog(catalog, location(at)?),
            Read::GlobalForms(at) => ReadKey::GlobalForms(location(at)?),
            Read::Projects => ReadKey::Projects,
        })
    }

    /// The state of `read`, while anything of it is kept.
    pub(crate) fn read_state(&self, read: Read) -> Option<&ReadState> {
        match self.find_key(read)? {
            ReadKey::Session(session, read) => self.sessions.live(session).map(|session| &session.reads[read]),
            key => self.reads.get(&key),
        }
    }

    /// Starts or joins the read `key`: what the caller does, with the token of a new load.
    pub(crate) fn start_read(&mut self, key: ReadKey) -> Start {
        let stale = match self.read_state_mut(key) {
            Some(ReadState::Done) => return Start::Done,
            Some(ReadState::Loading { token, phase: Phase::Stale }) => Some(*token),
            Some(ReadState::Loading { token, .. }) => return Start::Join(*token),
            _ => None,
        };
        let token = self.token();
        match stale {
            Some(stale) => Start::After(token, stale),
            None => Start::Run(token),
        }
    }

    /// Records the new load `token` of `key` as in flight, once a load that runs now has begun: a begin that fails
    /// leaves the read to the next caller.
    pub(crate) fn load_read(&mut self, key: ReadKey, token: u64, queued: bool) {
        if let Some(read) = self.read_state_mut(key) {
            *read = ReadState::Loading { token, phase: if queued { Phase::Queued } else { Phase::Running } };
        }
    }

    /// The queued load `token` of `key` begins: the one it replaced settled.
    pub(crate) fn resume_read(&mut self, key: ReadKey, token: u64) {
        if let Some(ReadState::Loading { token: current, phase }) = self.read_state_mut(key)
            && *current == token
        {
            *phase = Phase::Running;
        }
    }

    /// Settles the load `token` of `key`; see [`ReadState::settle`].
    pub(crate) fn settle_read(&mut self, key: ReadKey, token: u64, ok: bool) {
        if let Some(read) = self.read_state_mut(key) {
            read.settle(token, ok);
        }
    }

    /// The state of `key`, `None` once its session record is gone.
    pub(crate) fn read_state_mut(&mut self, key: ReadKey) -> Option<&mut ReadState> {
        match key {
            ReadKey::Session(session, read) => self.sessions.live_mut(session).map(|session| &mut session.reads[read]),
            _ => Some(self.reads.entry(key).or_default()),
        }
    }

    /// Read, or being read.
    pub(crate) fn has_read(&self, read: Read) -> bool {
        self.read_state(read).is_some_and(ReadState::has)
    }

    pub(crate) fn invalidate(&mut self, read: Read) {
        if let Some(key) = self.find_key(read) {
            self.invalidate_key(key);
        }
    }

    pub(crate) fn invalidate_key(&mut self, key: ReadKey) {
        if let Some(state) = self.read_state_mut(key) {
            state.invalidate();
        }
    }

    /// Invalidates every read, as after a disconnect.
    pub(crate) fn invalidate_all(&mut self) {
        self.sessions.iter_mut().for_each(|session| session.reads.invalidate());
        self.reads.values_mut().for_each(ReadState::invalidate);
    }

    /// Invalidates every catalog read.
    pub(crate) fn invalidate_catalogs(&mut self) {
        for (key, state) in &mut self.reads {
            if matches!(key, ReadKey::Catalog(..)) {
                state.invalidate();
            }
        }
    }
}
