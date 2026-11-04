//! Pending permissions (F.7).

use opencode_api::client::RequestOptions;
use opencode_api::generated::*;

use crate::state::{Data, Error, State, Task, evict_missing, is_tag};

impl State {
    /// Pending permission requests of a session; none until read or asked.
    pub fn permissions(&self, session: &SessionID) -> Option<&[PermissionRequest]> {
        self.permission.get(session).map(Vec::as_slice)
    }

    /// Sessions with pending permission requests.
    pub fn permission_sessions(&self) -> Vec<&SessionID> {
        self.permission
            .iter()
            .filter(|(_, requests)| !requests.is_empty())
            .map(|(session, _)| session)
            .collect()
    }

    pub(crate) fn on_permission_asked(&mut self, data: &PermissionAskedData) {
        let requests = self.permission.entry(data.session_id.clone()).or_default();
        if requests.iter().any(|request| request.id == data.id) {
            return;
        }
        requests.push(PermissionRequest {
            id: data.id.clone(),
            session_id: data.session_id.clone(),
            action: data.action.clone(),
            resources: data.resources.clone(),
            save: data.save.clone(),
            metadata: data.metadata.clone(),
            source: data.source.clone(),
            message: data.message.clone(),
        });
        self.log.permissions(&data.session_id);
    }

    pub(crate) fn remove_permission(&mut self, session: &SessionID, request: &PermissionID) {
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
    /// Reads pending permissions once per invalidation (`permission.sync`).
    pub fn permission_sync(&self, session: &SessionID) -> Task<()> {
        let session = session.clone();
        self.sync_run(
            format!("session.permission:{}", session.0),
            move |data| async move {
                let started = data.read(|state| state.deletion_epoch);
                let list = data
                    .client()
                    .permission_list(
                        &PermissionListInput {
                            session_id: session.clone(),
                        },
                        &RequestOptions::default(),
                    )
                    .await
                    .map_err(|error| evict_missing(&data, error))?;
                data.write(|state| {
                    if state.deleted_since(&session, started) {
                        return;
                    }
                    state.permission.insert(session.clone(), list);
                    state.log.permissions(&session);
                });
                Ok(())
            },
        )
    }

    pub fn permission_invalidate(&self, session: &SessionID) {
        self.write(|state| {
            state
                .syncs
                .invalidate(&format!("session.permission:{}", session.0))
        });
    }

    /// Replies and drops the request; an already settled request counts as replied.
    pub async fn permission_reply(&self, input: PermissionReplyInput) -> Result<(), Error> {
        if let Err(error) = self
            .client()
            .permission_reply(&input, &RequestOptions::default())
            .await
        {
            let error = Error::new(error);
            if !is_tag(&error, "PermissionNotFoundError") {
                return Err(error);
            }
        }
        self.write(|state| state.remove_permission(&input.session_id, &input.request_id));
        Ok(())
    }
}
