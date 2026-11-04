//! Sessions and session status (F.7): info, families, deletion, status, creation, and the
//! session events.

use std::collections::HashSet;

use futures_util::FutureExt;
use opencode_api::client::RequestOptions;
use opencode_api::generated::*;

use crate::connection::Follow;
use crate::inbox::{InboxExt, now};
use crate::messages::{MessageExt, from_event};
use crate::state::{Data, Error, SessionStatus, State, Task, evict_missing};

/// Children per page of a family read (`CHILD_PAGE`).
const CHILD_PAGE: i64 = 200;

/// Input of [`Data::session_create`].
#[derive(Debug, Clone, Default)]
pub struct CreateSession {
    pub id: Option<SessionID>,
    pub title: Option<String>,
    pub agent: Option<AgentID>,
    pub model: Option<ModelRef>,
    pub location: Option<LocationPublicRef>,
    pub project_id: Option<ProjectID>,
}

/// How an execution ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Outcome {
    Succeeded,
    Failed,
    Interrupted,
}

impl State {
    /// Loaded sessions, most recently updated first.
    pub fn sessions(&self) -> Vec<&SessionInfo> {
        let mut sessions: Vec<_> = self.info.values().collect();
        sessions.sort_by(|a, b| b.time.updated.total_cmp(&a.time.updated));
        sessions
    }

    pub fn session(&self, id: &SessionID) -> Option<&SessionInfo> {
        self.info.get(id)
    }

    /// True when the session is known to be deleted.
    pub fn is_missing(&self, id: &SessionID) -> bool {
        self.missing.contains(id)
    }

    /// True while an optimistic creation of the session is in flight.
    pub fn is_creating(&self, id: &SessionID) -> bool {
        self.creating.contains_key(id)
    }

    /// The family root: the walk up `parentID` through loaded info stops at the first parent that
    /// is not loaded (the furthest known ancestor) or repeats.
    pub fn root(&self, id: &SessionID) -> SessionID {
        let mut current = id.clone();
        let mut parent = self.info.get(id).and_then(|info| info.parent_id.clone());
        let mut seen = HashSet::from([id.clone()]);
        while let Some(next) = parent {
            if !seen.insert(next.clone()) {
                break;
            }
            parent = self.info.get(&next).and_then(|info| info.parent_id.clone());
            current = next;
        }
        current
    }

    /// Every known session of the family of `id`.
    pub fn family(&self, id: &SessionID) -> &[SessionID] {
        self.family
            .get(&self.root(id))
            .map(Vec::as_slice)
            .unwrap_or_default()
    }

    /// A child's own cost, or a root's cost with every known descendant.
    pub fn cost(&self, id: &SessionID) -> f64 {
        let Some(session) = self.info.get(id) else {
            return 0.0;
        };
        if session.parent_id.is_some() {
            return session.cost;
        }
        match self.family.get(id) {
            Some(family) => family
                .iter()
                .map(|member| self.info.get(member).map_or(0.0, |info| info.cost))
                .sum(),
            None => session.cost,
        }
    }

    pub fn status(&self, id: &SessionID) -> SessionStatus {
        self.active.get(id).copied().unwrap_or(SessionStatus::Idle)
    }

    /// Running sessions.
    pub fn active_sessions(&self) -> Vec<&SessionID> {
        self.active
            .iter()
            .filter(|(_, status)| **status == SessionStatus::Running)
            .map(|(id, _)| id)
            .collect()
    }

    pub(crate) fn set_status(&mut self, id: &SessionID, status: SessionStatus) {
        if let Some((_, updates)) = &mut self.active_updates {
            updates.insert(id.clone(), Some(status));
        }
        if self.active.insert(id.clone(), status) != Some(status) {
            self.log.status(id);
        }
    }

    /// Stores fetched or optimistic info (`remember`).
    pub(crate) fn remember(&mut self, info: SessionInfo) {
        let id = info.id.clone();
        self.clear_deleted(&id);
        self.info.insert(id.clone(), info);
        self.log.session(&id);
        self.syncs.complete(&format!("session:{}", id.0));
        self.register(&id);
    }

    /// Adds a session to the family index; a tentative family keyed by the session folds into
    /// its resolved root (`registerSession`).
    pub(crate) fn register(&mut self, id: &SessionID) {
        if !self.info.contains_key(id) {
            return;
        }
        let root = self.root(id);
        if root != *id
            && let Some(orphans) = self.family.remove(id)
        {
            let members = self.family.entry(root.clone()).or_default();
            for member in orphans {
                if !members.contains(&member) {
                    members.push(member);
                }
            }
        }
        let family = self.family.entry(root).or_default();
        if !family.contains(id) {
            family.push(id.clone());
        }
    }

    pub(crate) fn remove_session(&mut self, id: &SessionID) {
        if let Some((_, updates)) = &mut self.active_updates {
            updates.insert(id.clone(), None);
        }
        for item in self.pending.get(id).into_iter().flatten() {
            self.outbox.remove(item.id());
        }
        for key in [
            "session",
            "session.family",
            "session.pending",
            "session.message",
            "session.permission",
        ] {
            self.syncs.invalidate(&format!("{key}:{}", id.0));
        }
        self.syncs
            .invalidate_prefix(&format!("session.form:{}:", id.0));
        self.info.remove(id);
        self.active.remove(id);
        self.messages.remove(id);
        self.cursor.remove(id);
        self.loading.remove(id);
        self.pending.remove(id);
        self.permission.remove(id);
        self.family.retain(|_, family| {
            family.retain(|member| member != id);
            !family.is_empty()
        });
        self.log.session(id);
        self.log.status(id);
        self.log.messages(id);
        self.log.pending(id);
        self.log.permissions(id);
    }

    /// Drops heavy cached data of one session, keeping unacknowledged submissions
    /// (`evictSession`).
    fn evict_session(&mut self, id: &SessionID) {
        if self.session_outbox.contains(id) {
            return;
        }
        self.syncs.invalidate(&format!("session.pending:{}", id.0));
        self.syncs.invalidate(&format!("session.message:{}", id.0));
        self.message_loads.remove(id);
        let pending: Vec<_> = self
            .pending(id)
            .iter()
            .filter(|item| self.outbox.contains(item.id()))
            .cloned()
            .collect();
        let messages: Vec<_> = self
            .messages(id)
            .iter()
            .filter(|item| self.outbox.contains(item.id()))
            .cloned()
            .collect();
        self.messages.remove(id);
        self.cursor.remove(id);
        self.loading.remove(id);
        self.pending.remove(id);
        if !messages.is_empty() {
            self.messages
                .insert(id.clone(), crate::messages::Transcript::new(messages));
        }
        if !pending.is_empty() {
            self.pending.insert(id.clone(), pending);
        }
        self.log.messages(id);
        self.log.pending(id);
    }

    /// Clears heavy cached data of the root and every known descendant (`evict`).
    pub(crate) fn evict(&mut self, id: &SessionID) {
        let root = self.root(id);
        let mut members = vec![root.clone(), id.clone()];
        members.extend(self.family.get(&root).into_iter().flatten().cloned());
        let mut seen = HashSet::new();
        for member in members {
            if seen.insert(member.clone()) {
                self.evict_session(&member);
            }
        }
    }

    fn edit_info(&mut self, id: &SessionID, f: impl FnOnce(&mut SessionInfo)) {
        if let Some(info) = self.info.get_mut(id) {
            f(info);
            self.log.session(id);
        }
    }

    /// True when a session read is worth revalidating: its info is loaded or a read is active.
    fn known(&self, id: &SessionID) -> bool {
        self.info.contains_key(id) || self.syncs.has(&format!("session:{}", id.0))
    }

    fn revalidate(&mut self, id: &SessionID) -> Vec<Follow> {
        if !self.known(id) {
            return Vec::new();
        }
        self.syncs.invalidate(&format!("session:{}", id.0));
        vec![Follow::Session(id.clone())]
    }

    pub(crate) fn on_session_created(&mut self, data: &SessionCreatedData) -> Vec<Follow> {
        let id = &data.session_id;
        self.clear_deleted(id);
        self.session_outbox.remove(id);
        self.syncs.invalidate(&format!("session:{}", id.0));
        // A new session starts empty, so live events are its source of truth. Separate pending and
        // message reads could both miss an input promoted between them and overwrite the events.
        self.syncs.complete(&format!("session.pending:{}", id.0));
        self.syncs.complete(&format!("session.message:{}", id.0));
        vec![Follow::Session(id.clone())]
    }

    pub(crate) fn on_usage_updated(&mut self, data: &SessionUsageUpdatedData) {
        self.edit_info(&data.session_id, |info| {
            info.cost = data.cost;
            info.tokens = data.tokens.clone();
        });
    }

    pub(crate) fn on_agent_selected(&mut self, event: &SessionAgentSelected) {
        let data = &event.data;
        let previous = self
            .info
            .get(&data.session_id)
            .and_then(|info| info.agent.clone());
        self.edit_info(&data.session_id, |info| {
            info.agent = Some(data.agent.clone())
        });
        let row = SessionMessageAgentSelected {
            id: from_event(&event.id),
            r#type: "agent-switched".into(),
            agent: data.agent.clone(),
            previous,
            metadata: None,
            time: SessionInboxUserTime {
                created: event.created,
            },
        };
        self.insert_message(&data.session_id, SessionMessageInfo::AgentSwitched(row));
    }

    pub(crate) fn on_model_selected(&mut self, event: &SessionModelSelected) -> Vec<Follow> {
        let data = &event.data;
        let previous = data.previous.clone().or_else(|| {
            self.info
                .get(&data.session_id)
                .and_then(|info| info.model.clone())
        });
        self.edit_info(&data.session_id, |info| {
            info.model = Some(data.model.clone())
        });
        if !self.messages.contains_key(&data.session_id) {
            return Vec::new();
        }
        let id = from_event(&event.id);
        let row = SessionMessageModelSelected {
            id: id.clone(),
            r#type: "model-switched".into(),
            model: data.model.clone(),
            previous,
            metadata: None,
            time: SessionInboxUserTime {
                created: event.created,
            },
        };
        self.insert_message(&data.session_id, SessionMessageInfo::ModelSwitched(row));
        vec![Follow::Message(data.session_id.clone(), id)]
    }

    pub(crate) fn on_moved(&mut self, event: &SessionMoved) {
        let data = &event.data;
        let Some(current) = self.info.get(&data.session_id) else {
            return;
        };
        let previous = SessionMessageLocationSwitchedPrevious {
            location: current.location.clone(),
            project_id: Some(current.project_id.clone()),
            subpath: current.subpath.clone(),
        };
        let location = LocationPublicRef {
            directory: data.location.directory.clone(),
        };
        self.edit_info(&data.session_id, |info| {
            info.location = location.clone();
            info.project_id = data.project_id.clone();
            info.subpath = data.subpath.clone();
        });
        let row = SessionMessageLocationSwitched {
            id: from_event(&event.id),
            r#type: "location-switched".into(),
            project_id: Some(data.project_id.clone()),
            subpath: data.subpath.clone(),
            location,
            previous: Some(Some(previous)),
            metadata: None,
            time: SessionInboxUserTime {
                created: event.created,
            },
        };
        self.insert_message(&data.session_id, SessionMessageInfo::LocationSwitched(row));
    }

    pub(crate) fn on_permissions(&mut self, data: &SessionPermissionsData) {
        self.edit_info(&data.session_id, |info| {
            info.permissions = Some(data.permissions.clone())
        });
    }

    pub(crate) fn on_metadata(&mut self, data: &SessionMetadataUpdatedData) {
        // The event carries the whole record, so keys it drops go too.
        self.edit_info(&data.session_id, |info| {
            info.metadata = Some(data.metadata.clone())
        });
    }

    pub(crate) fn on_archived(&mut self, id: &SessionID, archived: Option<f64>) {
        self.edit_info(id, |info| info.time.archived = archived);
    }

    pub(crate) fn on_revert_staged(&mut self, data: &SessionRevertStagedData) {
        self.edit_info(&data.session_id, |info| {
            info.revert = Some(data.revert.clone())
        });
    }

    pub(crate) fn on_revert_cleared(&mut self, id: &SessionID) {
        self.edit_info(id, |info| info.revert = None);
    }

    pub(crate) fn on_revert_committed(&mut self, data: &SessionRevertCommittedData) {
        let id = &data.session_id;
        self.on_revert_cleared(id);
        // The projector also deletes inbox items enqueued at or after the boundary, without a
        // cancel event.
        let pending = self.pending.entry(id.clone()).or_default();
        pending.retain(|item| item.id() < data.to.as_str());
        self.log.pending(id);
        self.revert_messages(id, &data.to);
    }

    pub(crate) fn on_execution_started(&mut self, id: &SessionID) -> Vec<Follow> {
        self.set_status(id, SessionStatus::Running);
        // Revalidate so `time.busy` follows the projected execution start.
        self.revalidate(id)
    }

    pub(crate) fn on_execution_ended(
        &mut self,
        event_id: &EventID,
        created: f64,
        id: &SessionID,
        outcome: Outcome,
        error: Option<&SessionStructuredError>,
        shutdown: bool,
    ) -> Vec<Follow> {
        self.set_status(id, SessionStatus::Idle);
        self.clear_retry(id);
        if shutdown {
            return Vec::new();
        }
        // Mirror the projected idle marker so turn boundaries match before the next read.
        let row = SessionMessageIdle {
            id: from_event(event_id),
            r#type: "idle".into(),
            outcome: match outcome {
                Outcome::Succeeded => SessionInfoOutcome::Succeeded,
                Outcome::Failed => SessionInfoOutcome::Failed,
                Outcome::Interrupted => SessionInfoOutcome::Interrupted,
            },
            error: error.cloned(),
            metadata: None,
            time: SessionInboxUserTime { created },
        };
        self.insert_message(id, SessionMessageInfo::Idle(row));
        let mut follow = Vec::new();
        if self.has_live_tool(id) {
            self.syncs.invalidate(&format!("session.message:{}", id.0));
            follow.push(Follow::Messages(id.clone()));
        }
        // An event can overtake the first read; revalidate when that read is still active.
        follow.extend(self.revalidate(id));
        follow
    }

    pub(crate) fn on_viewed(&mut self, id: &SessionID) -> Vec<Follow> {
        self.revalidate(id)
    }
}

impl Data {
    /// Reads a session once per invalidation (`session.sync`); with `children`, also every direct
    /// child, under its own key.
    pub fn session_sync(&self, id: &SessionID, children: bool) -> Task<()> {
        let key = if children {
            "session.family"
        } else {
            "session"
        };
        let id = id.clone();
        self.sync_run(format!("{key}:{}", id.0), move |data| async move {
            let started = data.read(|state| state.deletion_epoch);
            let info = async {
                data.client()
                    .session_get(
                        &SessionGetInput {
                            session_id: id.clone(),
                        },
                        &RequestOptions::default(),
                    )
                    .await
                    .map_err(|error| evict_missing(&data, error))
            };
            let family = async {
                if !children {
                    return Ok(Vec::new());
                }
                list_children(&data, &id).await
            };
            let (info, family) = futures_util::future::try_join(info, family).await?;
            data.write(|state| {
                for session in std::iter::once(info).chain(family) {
                    if state.deleted_since(&session.id, started) {
                        continue;
                    }
                    state.remember(session);
                }
            });
            Ok(())
        })
    }

    pub fn session_invalidate(&self, id: &SessionID) {
        self.write(|state| state.syncs.invalidate(&format!("session:{}", id.0)));
    }

    /// Stores fetched info, as a list read does.
    pub fn remember(&self, info: SessionInfo) {
        self.write(|state| state.remember(info));
    }

    pub fn set_status(&self, id: &SessionID, status: SessionStatus) {
        self.write(|state| state.set_status(id, status));
    }

    /// Forgets a session as deleted.
    pub fn forget(&self, id: &SessionID) {
        self.write(|state| state.mark_deleted(id));
    }

    /// Clears heavy cached data of the family of `id`.
    pub fn evict(&self, id: &SessionID) {
        self.write(|state| state.evict(id));
    }

    /// Optimistic creation: admits a local record under a client-minted ID so a session view can
    /// open at once, then creates the session. Prompts to it wait for the request; a failure
    /// removes the record unless the server acknowledged it.
    pub fn session_create(&self, input: CreateSession) -> (SessionID, Task<SessionInfo>) {
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| SessionID(opencode_api::id::session()));
        let mut state = self.lock();
        let location = input.location.clone().unwrap_or_else(|| LocationPublicRef {
            directory: AbsolutePath(state.default_location().directory.clone()),
        });
        let fresh = !state.info.contains_key(&id);
        state.clear_deleted(&id);
        if fresh {
            let created = now();
            let project_id = input
                .project_id
                .clone()
                .or_else(|| {
                    state
                        .location(Some(&(&location).into()))
                        .and_then(|data| data.info.as_ref())
                        .map(|info| info.project.id.clone())
                })
                .unwrap_or_default();
            state.session_outbox.insert(id.clone());
            state.remember(SessionInfo {
                id: id.clone(),
                project_id,
                agent: input.agent.clone(),
                model: input.model.clone(),
                cost: 0.0,
                tokens: TokenUsageInfo::default(),
                time: SessionInfoTime {
                    created,
                    updated: created,
                    ..Default::default()
                },
                title: input.title.clone(),
                location: location.clone(),
                ..Default::default()
            });
            // A mounted optimistic session must not read its empty collections before creation
            // settles; the `session.created` echo reads its info again.
            for key in ["session.family", "session.pending", "session.message"] {
                state.syncs.complete(&format!("{key}:{}", id.0));
            }
        }
        let request = SessionCreateInput {
            id: Some(Some(id.clone())),
            title: input.title.map(Some),
            agent: input.agent.map(Some),
            model: input.model.map(Some),
            location: Some(Some(location)),
            ..Default::default()
        };
        let token = state.token();
        let data = self.clone();
        let session = id.clone();
        let task = self.spawn(async move {
            let result = data
                .client()
                .session_create(&request, &RequestOptions::default())
                .await
                .map_err(Error::new);
            data.write(|state| {
                match &result {
                    Ok(info) => {
                        state.session_outbox.remove(&session);
                        state.remember(info.clone());
                    }
                    // Roll back only a record this call admitted and neither the echo nor the
                    // response acknowledged: anything else is server state.
                    Err(_) => {
                        if fresh && state.session_outbox.remove(&session) {
                            state.remove_session(&session);
                        }
                    }
                }
                if state
                    .creating
                    .get(&session)
                    .is_some_and(|(current, _)| *current == token)
                {
                    state.creating.remove(&session);
                }
            });
            result
        });
        if fresh {
            let gate = task
                .clone()
                .map(|result| result.map(|_| ()))
                .boxed()
                .shared();
            state.creating.insert(id.clone(), (token, gate));
        }
        self.flush(&mut state);
        (id, task)
    }
}

/// Every direct child, newest first, through every page (`listChildren`).
async fn list_children(data: &Data, parent: &SessionID) -> Result<Vec<SessionInfo>, Error> {
    let mut input = SessionListInput {
        parent_id: Some(Some(parent.clone())),
        order: Some(SessionListInputOrder::Desc),
        limit: Some(CHILD_PAGE),
        ..Default::default()
    };
    let mut children = Vec::new();
    loop {
        let page = data
            .client()
            .session_list(&input, &RequestOptions::default())
            .await
            .map_err(Error::new)?;
        let full = page.data.len() as i64 >= CHILD_PAGE;
        children.extend(page.data);
        let Some(next) = page.cursor.next.flatten().filter(|_| full) else {
            return Ok(children);
        };
        // Later pages carry only the cursor and the size, as in TS.
        input = SessionListInput {
            cursor: Some(next),
            limit: Some(CHILD_PAGE),
            ..Default::default()
        };
    }
}

impl Data {
    /// Refetches one projected message and upserts it (the `session.model.selected` read).
    pub(crate) fn fetch_message(&self, session: SessionID, message: SessionMessageID) {
        let data = self.clone();
        self.refresh(async move {
            let item = data
                .client()
                .session_message_get(
                    &SessionMessageGetInput {
                        session_id: session.clone(),
                        message_id: message,
                    },
                    &RequestOptions::default(),
                )
                .await
                .map_err(Error::new)?;
            data.write(|state| {
                let item = state.stored(item);
                state.upsert_message(&session, item);
            });
            Ok(())
        });
    }

    /// Applies a live title after the session's reads, so a racing read cannot overwrite it.
    pub(crate) fn renamed(&self, session: SessionID, title: String) {
        let data = self.clone();
        self.refresh(async move {
            let family = data.read(|state| {
                state
                    .syncs
                    .pending(&format!("session.family:{}", session.0))
            });
            let own = data.session_sync(&session, false);
            if family {
                futures_util::future::try_join(own, data.session_sync(&session, true)).await?;
            } else {
                own.await?;
            }
            data.write(|state| state.edit_info(&session, |info| info.title = Some(title)));
            Ok(())
        });
    }
}
