//! Pending permissions (F.7).
use opencode_api::generated::*;

use crate::state::{Data, Error, State, Task, evict_missing, is_tag};

impl State {
    /// Pending permission requests of a session; none until read or asked.
    pub fn permissions(&self, session: &SessionID) -> Option<&[PermissionRequest]> {
        self.permission.get(session).map(Vec::as_slice)
    }

    /// Sessions with pending permission requests.
    pub fn permission_sessions(&self) -> Vec<&SessionID> {
        self.permission.iter().filter(|(_, requests)| !requests.is_empty()).map(|(session, _)| session).collect()
    }

    pub(crate) fn on_permission_asked(&mut self, data: &PermissionAskedData) {
        // A session the store found missing shows nothing, whatever arrives late (model O9).
        if self.missing.contains(&data.session_id) {
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
        if let Some(read) = self.permission_reads.get_mut(&data.session_id) {
            read.record(&data.id.0, Some(request.clone()));
        }
        let requests = self.permission.entry(data.session_id.clone()).or_default();
        if requests.iter().any(|item| item.id == data.id) {
            return;
        }
        requests.push(request);
        self.log.permissions(&data.session_id);
    }

    pub(crate) fn remove_permission(&mut self, session: &SessionID, request: &PermissionID) {
        if let Some(read) = self.permission_reads.get_mut(session) {
            read.record(&request.0, None);
        }
        let Some(requests) = self.permission.get_mut(session) else { return };
        let before = requests.len();
        requests.retain(|item| item.id != *request);
        if requests.len() != before {
            self.log.permissions(session);
        }
    }
}

impl Data {
    /// Reads pending permissions once per invalidation (`permission.sync`). Requests asked or
    /// settled while the read was in flight win over the snapshot (deviation O89-list-snapshots).
    pub fn permission_sync(&self, session: &SessionID) -> Task<()> {
        let (fetched, again) = (session.clone(), session.clone());
        self.overlay_sync(
            format!("session.permission:{}", session.0),
            session.clone(),
            |state| &mut state.permission_reads,
            session.clone(),
            |request| &request.id.0,
            move |data| async move {
                let list = data.client().permission_list(&PermissionListInput { session_id: fetched }).await;
                Ok((list.map_err(|error| evict_missing(&data, error))?, ()))
            },
            |state, session, list, ()| {
                state.permission.insert(session.clone(), list);
                state.log.permissions(session);
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
