use opencode_api::generated::*;

use crate::changes::Touched;
use crate::reads::{Read, SessionRead};
use crate::state::{Data, Error, State, Task, evict_missing, is_tag};

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
}

impl Data {
    /// Reads pending permissions once per invalidation. Requests opened or settled during the read take precedence
    /// over its snapshot.
    pub fn permission_sync(&self, session: &SessionID) -> Task<()> {
        let (fetched, again) = (session.clone(), session.clone());
        self.overlay_sync(
            self.keyed(Read::Session(session.as_str(), SessionRead::Permissions)),
            session.clone(),
            session.clone(),
            |state, session, overlay| state.sessions.get_or_insert(session).permission_read = Some(overlay),
            |state, session, ticket| {
                state.sessions.get_mut(session)?.permission_read.take_if(|read| read.ticket() == ticket)
            },
            |request| &request.id.0,
            move |data| async move {
                let list = data.client().permission_list(&PermissionListInput { session_id: fetched }).await;
                Ok((list.map_err(|error| evict_missing(&data, error))?, ()))
            },
            |state, session, list, ()| {
                state.sessions.get_or_insert(session).permissions = Some(list);
                state.touch(session, Touched::PERMISSIONS);
            },
            move |data| data.permission_sync(&again),
        )
    }

    /// Replies and drops the request; an already settled request counts as replied.
    pub async fn permission_reply(&self, input: PermissionReplyInput) -> Result<(), Error> {
        if let Err(error) = self.client().permission_reply(&input).await {
            let error = Error::new(error);
            if !is_tag(&error, "PermissionNotFoundError") {
                return Err(error);
            }
        }
        self.write(|state| state.remove_permission(&input.session_id, &input.request_id));
        Ok(())
    }
}
