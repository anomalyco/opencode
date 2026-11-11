//! Pending permissions (F.7).
use opencode_api::generated::*;

use crate::state::{Data, Error, Overlay, State, Task, evict_missing, is_tag};

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
        let Some(requests) = self.permission.get_mut(session) else {
            return;
        };
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
        let key = format!("session.permission:{}", session.0);
        let begin = session.clone();
        let session = session.clone();
        self.sync_start(
            key.clone(),
            move |state| {
                let ticket = state.token();
                state.permission_reads.insert(begin, Overlay::new(ticket));
                (state.deletion_epoch, ticket)
            },
            move |data, (started, ticket)| async move {
                let list =
                    match data.client().permission_list(&PermissionListInput { session_id: session.clone() }).await {
                        Ok(list) => list,
                        Err(error) => {
                            data.write(|state| Overlay::take(&mut state.permission_reads, &session, ticket));
                            return Err(evict_missing(&data, error));
                        }
                    };
                let reread = data.write(|state| {
                    let Some(read) = Overlay::take(&mut state.permission_reads, &session, ticket) else {
                        return false;
                    };
                    if state.deleted_since(&session, started) {
                        return false;
                    }
                    let Some(list) = read.apply(list, |request| &request.id.0) else {
                        state.syncs.invalidate(&key);
                        return true;
                    };
                    state.permission.insert(session.clone(), list);
                    state.log.permissions(&session);
                    false
                });
                if reread {
                    data.refresh(|data| data.permission_sync(&session));
                }
                Ok(())
            },
        )
    }

    pub fn permission_invalidate(&self, session: &SessionID) {
        self.write(|state| state.syncs.invalidate(&format!("session.permission:{}", session.0)));
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
