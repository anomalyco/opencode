use opencode_api::generated::*;

use crate::changes::Touched;
use crate::core::{Effect, List, Ticket};
use crate::state::{Error, Overlay, State};

impl State {
    /// Pending permission requests of a session; none until read or asked.
    pub fn permissions(&self, session: &(impl AsRef<str> + ?Sized)) -> Option<&[PermissionRequest]> {
        self.sessions.get(session.as_ref())?.permissions.as_deref()
    }

    /// Sessions with pending permission requests.
    pub fn permission_sessions(&self) -> Vec<&SessionID> {
        self.sessions
            .iter()
            .filter(|session| session.permissions.as_ref().is_some_and(|requests| !requests.is_empty()))
            .map(|session| &session.id)
            .collect()
    }

    pub(crate) fn on_permission_asked(&mut self, data: &PermissionAskedData) {
        // A session the store found missing shows nothing, whatever arrives late (model O9).
        if self.is_missing(&data.session_id) {
            return;
        }
        let request = PermissionRequest {
            id: data.id.clone(),
            session_id: data.session_id.clone(),
            action: data.action.clone(),
            resources: data.resources.clone(),
            save: data.save.clone(),
            metadata: data.metadata.clone(),
            source: data.source.clone(),
            message: data.message.clone(),
        };
        let session = self.sessions.get_or_insert(&data.session_id);
        if let Some(read) = &mut session.permission_read {
            read.record(&data.id.0, Some(request.clone()));
        }
        let requests = session.permissions.get_or_insert_default();
        if requests.iter().any(|item| item.id == data.id) {
            return;
        }
        requests.push(request);
        self.touch(&data.session_id, Touched::PERMISSIONS);
    }

    pub(crate) fn remove_permission(&mut self, session: &SessionID, request: &PermissionID) {
        let Some(record) = self.sessions.get_mut(session) else { return };
        if let Some(read) = &mut record.permission_read {
            read.record(&request.0, None);
        }
        let Some(requests) = &mut record.permissions else { return };
        let before = requests.len();
        requests.retain(|item| item.id != *request);
        if requests.len() != before {
            self.touch(session, Touched::PERMISSIONS);
        }
    }

    /// Begins a read of the pending permission requests of the session of `ticket`, with an overlay of the requests asked
    /// and replied to meanwhile.
    pub(crate) fn begin_permissions(&mut self, ticket: Ticket) -> List {
        let read = self.token();
        let record = &mut self.sessions[ticket.session()];
        record.permission_read = Some(Overlay::new(read));
        List { ticket, session: record.id.clone(), read, started: self.deletion_epoch }
    }

    /// Publishes the permission read `read` with the requests asked and replied to during it, unless a newer read or
    /// a deletion of the session since it began supersedes it. An overflowed overlay reads again instead.
    pub(crate) fn complete_permissions(
        &mut self,
        list: List,
        result: Result<Vec<PermissionRequest>, Error>,
        effects: &mut Vec<Effect>,
    ) {
        let session = list.session;
        let overlay = self
            .sessions
            .get_mut(&session)
            .and_then(|record| record.permission_read.take_if(|current| current.ticket() == list.read));
        let requests = match result {
            Ok(requests) => requests,
            Err(error) => return self.evict_missing(&error),
        };
        let Some(overlay) = overlay else { return };
        if self.deleted_since(&session, list.started) {
            return;
        }
        match overlay.apply(requests, |request| &request.id.0) {
            Some(requests) => {
                self.sessions.get_or_insert(&session).permissions = Some(requests);
                self.touch(&session, Touched::PERMISSIONS);
            }
            None => {
                self.invalidate_key(list.ticket.key);
                effects.push(Effect::Permissions(session));
            }
        }
    }
}
