//! Change tracking (F.7): what each flush touched, by revision.
//!
//! Every store mutation records what it touched. A flush (the end of an event batch or of a read)
//! numbers the changes with a revision and keeps the last [`LOG_LIMIT`] flushes. A view remembers
//! the revision it rendered and asks [`crate::Data::changes_since`] what changed after it.

use std::collections::{HashSet, VecDeque};

use opencode_api::generated::{SessionID, SessionMessageID};

/// Flushes kept for [`Log::since`]. A view further behind gets [`Changes::all`].
pub const LOG_LIMIT: usize = 256;

/// What changed. The query methods also answer true when a coarser entry covers the question.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Changes {
    /// Everything may have changed: the view fell out of the log.
    pub all: bool,
    /// Session list membership or order (any session info change).
    pub sessions: bool,
    /// Sessions whose info changed.
    pub session: HashSet<SessionID>,
    /// Sessions whose running state changed.
    pub status: HashSet<SessionID>,
    /// Sessions whose message list changed shape: insert, remove, reorder, reload, page.
    pub messages: HashSet<SessionID>,
    /// Messages whose content changed in place (a delta, a tool update).
    pub message: HashSet<(SessionID, SessionMessageID)>,
    /// Sessions whose pending inbox items changed.
    pub pending: HashSet<SessionID>,
    /// Sessions whose pending permissions changed.
    pub permissions: HashSet<SessionID>,
}

impl Changes {
    pub fn everything() -> Self {
        Self {
            all: true,
            ..Self::default()
        }
    }

    pub fn is_empty(&self) -> bool {
        !self.all
            && !self.sessions
            && self.session.is_empty()
            && self.status.is_empty()
            && self.messages.is_empty()
            && self.message.is_empty()
            && self.pending.is_empty()
            && self.permissions.is_empty()
    }

    pub fn sessions(&self) -> bool {
        self.all || self.sessions
    }

    pub fn session(&self, id: &SessionID) -> bool {
        self.all || self.session.contains(id)
    }

    pub fn status(&self, id: &SessionID) -> bool {
        self.all || self.status.contains(id)
    }

    /// The message list of `id` changed shape.
    pub fn messages(&self, id: &SessionID) -> bool {
        self.all || self.messages.contains(id)
    }

    /// Any message of `id` changed, in place or by shape.
    pub fn any_message(&self, id: &SessionID) -> bool {
        self.messages(id) || self.message.iter().any(|(session, _)| session == id)
    }

    /// The message changed in place, or its list changed shape.
    pub fn message(&self, session: &SessionID, message: &SessionMessageID) -> bool {
        self.messages(session) || self.message.contains(&(session.clone(), message.clone()))
    }

    pub fn pending(&self, id: &SessionID) -> bool {
        self.all || self.pending.contains(id)
    }

    pub fn permissions(&self, id: &SessionID) -> bool {
        self.all || self.permissions.contains(id)
    }

    pub fn extend(&mut self, other: &Changes) {
        self.all |= other.all;
        self.sessions |= other.sessions;
        self.session.extend(other.session.iter().cloned());
        self.status.extend(other.status.iter().cloned());
        self.messages.extend(other.messages.iter().cloned());
        self.message.extend(other.message.iter().cloned());
        self.pending.extend(other.pending.iter().cloned());
        self.permissions.extend(other.permissions.iter().cloned());
    }
}

/// The current changes and the log of flushed ones.
#[derive(Debug, Default)]
pub(crate) struct Log {
    revision: u64,
    pub(crate) current: Changes,
    entries: VecDeque<(u64, Changes)>,
}

impl Log {
    pub(crate) fn revision(&self) -> u64 {
        self.revision
    }

    /// Numbers the current changes; returns the new revision, or none when nothing changed.
    pub(crate) fn flush(&mut self) -> Option<u64> {
        if self.current.is_empty() {
            return None;
        }
        self.revision += 1;
        self.entries
            .push_back((self.revision, std::mem::take(&mut self.current)));
        if self.entries.len() > LOG_LIMIT {
            self.entries.pop_front();
        }
        Some(self.revision)
    }

    /// The union of the flushes after `seen`.
    pub(crate) fn since(&self, seen: u64) -> Changes {
        if seen >= self.revision {
            return Changes::default();
        }
        if self
            .entries
            .front()
            .is_none_or(|(oldest, _)| seen + 1 < *oldest)
        {
            return Changes::everything();
        }
        let mut changes = Changes::default();
        for (_, entry) in self.entries.iter().filter(|(revision, _)| *revision > seen) {
            changes.extend(entry);
        }
        changes
    }

    pub(crate) fn session(&mut self, id: &SessionID) {
        self.current.sessions = true;
        self.current.session.insert(id.clone());
    }

    pub(crate) fn status(&mut self, id: &SessionID) {
        self.current.status.insert(id.clone());
    }

    pub(crate) fn messages(&mut self, id: &SessionID) {
        self.current.messages.insert(id.clone());
    }

    pub(crate) fn message(&mut self, session: &SessionID, message: &SessionMessageID) {
        self.current
            .message
            .insert((session.clone(), message.clone()));
    }

    pub(crate) fn pending(&mut self, id: &SessionID) {
        self.current.pending.insert(id.clone());
    }

    pub(crate) fn permissions(&mut self, id: &SessionID) {
        self.current.permissions.insert(id.clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(value: &str) -> SessionID {
        SessionID(value.to_owned())
    }

    #[test]
    fn since_unions_newer_flushes_and_reports_everything_when_behind() {
        let mut log = Log::default();
        assert_eq!(log.flush(), None);
        log.session(&id("ses_a"));
        assert_eq!(log.flush(), Some(1));
        log.message(&id("ses_b"), &SessionMessageID("msg_1".into()));
        assert_eq!(log.flush(), Some(2));

        let all = log.since(0);
        assert!(all.session(&id("ses_a")) && all.sessions());
        assert!(all.message(&id("ses_b"), &SessionMessageID("msg_1".into())));
        assert!(!all.messages(&id("ses_b")));
        assert!(all.any_message(&id("ses_b")));

        let newer = log.since(1);
        assert!(!newer.session(&id("ses_a")));
        assert!(log.since(2).is_empty());

        for _ in 0..LOG_LIMIT {
            log.status(&id("ses_c"));
            log.flush();
        }
        assert!(log.since(1).all);
        assert!(!log.since(log.revision() - 1).all);
    }
}
