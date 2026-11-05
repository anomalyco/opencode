//! Inbox (F.7 core, F.8 rest): pending items, their status, and optimistic prompt and compaction
//! admission.
//!
//! F.7 took this file from F.8 because its tests (`solid-compaction.test.ts`,
//! `solid-pending-status.test.ts`) need admission; F.8 continues it.

use std::collections::HashSet;
use std::future::Future;

use futures_util::FutureExt;
use futures_util::future::BoxFuture;
use indexmap::IndexMap;
use opencode_api::generated::*;
use serde_json::Value;

use crate::messages::{MessageExt, from_event};
use crate::state::{Compacting, Data, Error, SessionStatus, State, Task, evict_missing};

/// `DataPendingStatus`: where a pending user prompt stands relative to the runner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PendingStatus {
    /// Promoted at the next idle boundary.
    Starting,
    /// Waits for the next step boundary of an execution that already delivered input.
    Steering,
    /// Outlived an execution that ended without delivering it.
    Stranded,
    /// Waits for every steer to drain.
    Queued,
}

/// An inbox event received while an inbox read is in flight.
#[derive(Debug, Clone)]
pub(crate) enum PendingUpdate {
    Removed,
    Delivery(SessionInboxDelivery),
    Item(Box<SessionInboxInfo>),
}

/// Fields every inbox member has.
pub trait InboxExt {
    fn id(&self) -> &str;
    fn delivery(&self) -> Option<&SessionInboxDelivery>;
    fn set_delivery(&mut self, delivery: SessionInboxDelivery);
    fn created(&self) -> f64;
}

impl InboxExt for SessionInboxInfo {
    fn id(&self) -> &str {
        match self {
            Self::User(item) => item.id.as_str(),
            Self::Synthetic(item) => item.id.as_str(),
            Self::Compaction(item) => item.id.as_str(),
            Self::Move(item) => item.id.as_str(),
            Self::Unknown(value) => value.get("id").and_then(Value::as_str).unwrap_or_default(),
        }
    }

    fn delivery(&self) -> Option<&SessionInboxDelivery> {
        match self {
            Self::User(item) => Some(&item.delivery),
            Self::Synthetic(item) => Some(&item.delivery),
            Self::Compaction(item) => Some(&item.delivery),
            Self::Move(item) => Some(&item.delivery),
            Self::Unknown(_) => None,
        }
    }

    fn set_delivery(&mut self, delivery: SessionInboxDelivery) {
        match self {
            Self::User(item) => item.delivery = delivery,
            Self::Synthetic(item) => item.delivery = delivery,
            Self::Compaction(item) => item.delivery = delivery,
            Self::Move(item) => item.delivery = delivery,
            Self::Unknown(value) => {
                if let Some(object) = value.as_object_mut() {
                    object.insert("delivery".into(), delivery.as_str().into());
                }
            }
        }
    }

    fn created(&self) -> f64 {
        match self {
            Self::User(item) => item.time.created,
            Self::Synthetic(item) => item.time.created,
            Self::Compaction(item) => item.time.created,
            Self::Move(item) => item.time.created,
            Self::Unknown(value) => value.pointer("/time/created").and_then(Value::as_f64).unwrap_or_default(),
        }
    }
}

/// A gate an admission waits for before it sends.
pub type Gate = BoxFuture<'static, Result<(), Error>>;

/// Input of [`Data::prompt`].
pub struct Prompt {
    pub input: SessionPromptInput,
    /// Waited for, with the session's creation and earlier admissions, before sending.
    pub gate: Option<Gate>,
    /// Runs after the gates, just before the prompt is sent.
    pub prepare: Option<Box<dyn FnOnce() -> Gate + Send>>,
}

impl From<SessionPromptInput> for Prompt {
    fn from(input: SessionPromptInput) -> Self {
        Self { input, gate: None, prepare: None }
    }
}

impl State {
    /// Pending inbox items in admission order (`pending.list`).
    pub fn pending(&self, session: &SessionID) -> &[SessionInboxInfo] {
        self.pending.get(session).map(Vec::as_slice).unwrap_or_default()
    }

    /// Pending user and synthetic inputs (`input.list`); compactions are control items.
    pub fn inputs(&self, session: &SessionID) -> Vec<&str> {
        self.pending(session).iter().filter(|item| item.tag() != "compaction").map(InboxExt::id).collect()
    }

    pub fn has_input(&self, session: &SessionID, inbox: &str) -> bool {
        self.pending(session).iter().any(|item| item.id() == inbox && item.tag() != "compaction")
    }

    /// `pending.status`: an execution's idle boundary promotes every pending steer at once, so a
    /// steer only waits behind work once the current execution has delivered input.
    pub fn pending_status(&self, session: &SessionID, inbox: &str) -> Option<PendingStatus> {
        let pending = self.pending(session);
        let item = pending.iter().find(|item| item.id() == inbox && item.tag() == "user")?;
        if item.delivery() == Some(&SessionInboxDelivery::Queue) {
            return Some(PendingStatus::Queued);
        }
        let messages = self.messages(session);
        let boundary = messages.iter().rposition(|item| item.tag() == "idle");
        if self.status(session) == SessionStatus::Idle {
            let stranded = boundary.is_some_and(|at| item.created() <= messages[at].created());
            return Some(if stranded { PendingStatus::Stranded } else { PendingStatus::Starting });
        }
        let after = boundary.map_or(0, |at| at + 1);
        let delivered = messages[after..]
            .iter()
            .any(|entry| entry.tag() == "user" && !pending.iter().any(|other| other.id() == entry.id()));
        Some(if delivered { PendingStatus::Steering } else { PendingStatus::Starting })
    }

    /// Upserts an admitted item into pending and, for user and synthetic items, the transcript
    /// (`admitLocal`). This reconciles a durable echo with its optimistic placeholder.
    pub(crate) fn admit_local(&mut self, item: SessionInboxInfo) {
        let session = inbox_session(&item);
        let pending = self.pending.entry(session.clone()).or_default();
        match pending.iter().position(|entry| entry.id() == item.id()) {
            Some(at) => pending[at] = item.clone(),
            None => pending.push(item.clone()),
        }
        self.log.pending(&session);
        if item.tag() != "compaction" {
            self.materialize(&item);
        }
    }

    /// The transcript row of a user or synthetic inbox item (`materializeInboxMessage`).
    pub(crate) fn materialize(&mut self, item: &SessionInboxInfo) {
        let row = match item {
            SessionInboxInfo::User(item) => SessionMessageInfo::User(SessionMessageUser {
                id: item.id.clone(),
                r#type: "user".into(),
                text: item.payload.text.clone(),
                files: item.payload.files.clone(),
                agents: item.payload.agents.clone(),
                skills: item.payload.skills.clone(),
                metadata: item.payload.metadata.clone(),
                time: item.time.clone(),
            }),
            SessionInboxInfo::Synthetic(item) => SessionMessageInfo::Synthetic(SessionMessageSynthetic {
                id: item.id.clone(),
                r#type: "synthetic".into(),
                text: item.payload.text.clone(),
                description: item.payload.description.clone(),
                metadata: item.payload.metadata.clone(),
                time: item.time.clone(),
            }),
            _ => return,
        };
        self.upsert_message(&inbox_session(item), row);
    }

    /// Removes an item from pending and the transcript (`retractLocal`).
    pub(crate) fn retract_local(&mut self, session: &SessionID, inbox: &str) {
        self.remove_pending(session, inbox);
        if let Some(transcript) = self.messages.get_mut(session)
            && transcript.remove(inbox).is_some()
        {
            self.log.messages(session);
        }
    }

    pub(crate) fn remove_pending(&mut self, session: &SessionID, inbox: &str) {
        if let Some((_, updates)) = self.pending_updates.get_mut(session) {
            updates.insert(inbox.to_owned(), PendingUpdate::Removed);
        }
        let Some(pending) = self.pending.get_mut(session) else {
            return;
        };
        let before = pending.len();
        pending.retain(|item| item.id() != inbox);
        if pending.len() != before {
            self.log.pending(session);
        }
    }

    fn update_pending(&mut self, session: &SessionID, inbox: &str, delivery: &SessionInboxDelivery) {
        let position = self.pending(session).iter().position(|item| item.id() == inbox);
        let update = match position {
            Some(at) => {
                let mut item = self.pending[session][at].clone();
                item.set_delivery(delivery.clone());
                PendingUpdate::Item(Box::new(item))
            }
            None => PendingUpdate::Delivery(delivery.clone()),
        };
        if let Some((_, updates)) = self.pending_updates.get_mut(session) {
            updates.insert(inbox.to_owned(), update);
        }
        let Some(at) = position else {
            return;
        };
        let item = &mut self.pending.get_mut(session).expect("found above")[at];
        if item.delivery() == Some(delivery) {
            return;
        }
        item.set_delivery(delivery.clone());
        self.log.pending(session);
    }

    fn observe(&mut self, session: &SessionID, inbox: &str) {
        if let Some(active) = self.compacting.get_mut(session) {
            active.observed.insert(inbox.to_owned());
        }
    }

    pub(crate) fn on_inbox_enqueued(&mut self, event: &SessionInboxEnqueued) {
        let data = &event.data;
        let session = &data.session_id;
        self.outbox.remove(data.inbox_id.as_str());
        let Some(item) = inbox_item(event) else {
            return;
        };
        if let Some((_, updates)) = self.pending_updates.get_mut(session) {
            updates.insert(item.id().to_owned(), PendingUpdate::Item(Box::new(item.clone())));
        }
        let compaction = item.tag() == "compaction";
        self.admit_local(item);
        if !compaction {
            return;
        }
        self.observe(session, data.inbox_id.as_str());
        let Some(active) = self.compacting.get(session) else {
            return;
        };
        let proposed = active.id.clone();
        if proposed != data.inbox_id && self.outbox.remove(proposed.as_str()) {
            self.remove_pending(session, proposed.as_str());
        }
    }

    pub(crate) fn on_inbox_delivered(&mut self, event: &SessionInboxDelivered) {
        let data = &event.data;
        let session = &data.session_id;
        let inbox = data.inbox_id.as_str();
        let admitted = self.has_input(session, inbox);
        self.remove_pending(session, inbox);
        if admitted
            && let Some(transcript) = self.messages.get_mut(session)
            && let Some(item) = transcript.get_mut(inbox)
        {
            item.set_created(event.created);
            transcript.move_last(inbox);
            self.log.messages(session);
        }
        self.observe(session, inbox);
    }

    pub(crate) fn on_inbox_delivery_changed(&mut self, data: &SessionInboxDeliveryChangedData) {
        self.update_pending(&data.session_id, data.inbox_id.as_str(), &data.delivery);
    }

    pub(crate) fn on_inbox_cancelled(&mut self, data: &SessionInboxDeliveredData) {
        self.retract_local(&data.session_id, data.inbox_id.as_str());
        self.observe(&data.session_id, data.inbox_id.as_str());
    }

    pub(crate) fn on_compaction_started(&mut self, event: &SessionCompactionStarted) {
        let data = &event.data;
        let session = &data.session_id;
        if let Some(input) = &data.input_id {
            self.remove_pending(session, input.as_str());
        }
        let row = SessionMessageCompactionRunning {
            r#type: "compaction".into(),
            id: data.input_id.clone().unwrap_or_else(|| from_event(&event.id)),
            metadata: None,
            time: SessionInboxUserTime { created: event.created },
            status: "running".into(),
            reason: data.reason.clone(),
            summary: String::new(),
        };
        self.insert_message(session, SessionMessageInfo::Compaction(SessionMessageCompaction::Running(row)));
        if let Some(input) = &data.input_id {
            self.observe(session, input.as_str());
        }
    }

    pub(crate) fn on_compaction_failed_inbox(&mut self, event: &SessionCompactionFailed) {
        let data = &event.data;
        if let Some(input) = &data.input_id {
            self.remove_pending(&data.session_id, input.as_str());
        }
        self.on_compaction_failed(event);
        if let Some(input) = &data.input_id {
            self.observe(&data.session_id, input.as_str());
        }
    }
}

fn inbox_session(item: &SessionInboxInfo) -> SessionID {
    match item {
        SessionInboxInfo::User(item) => item.session_id.clone(),
        SessionInboxInfo::Synthetic(item) => item.session_id.clone(),
        SessionInboxInfo::Compaction(item) => item.session_id.clone(),
        SessionInboxInfo::Move(item) => item.session_id.clone(),
        SessionInboxInfo::Unknown(value) => {
            SessionID(value.get("sessionID").and_then(Value::as_str).unwrap_or_default().to_owned())
        }
    }
}

/// The inbox item of an enqueue event: its item with the event's ID, session, and time.
fn inbox_item(event: &SessionInboxEnqueued) -> Option<SessionInboxInfo> {
    let mut value = serde_json::to_value(&event.data.item).ok()?;
    let object = value.as_object_mut()?;
    object.insert("id".into(), event.data.inbox_id.as_str().into());
    object.insert("sessionID".into(), event.data.session_id.as_str().into());
    object.insert("time".into(), serde_json::json!({ "created": event.created }));
    serde_json::from_value(value).ok()
}

/// Inline `data:` attachments of an optimistic row (`optimisticFiles`). File URIs stay off it:
/// their durable forms are server-loaded, so they fill in when the echo upserts the row.
fn optimistic_files(files: Option<&Vec<PromptInputFileAttachment>>) -> Option<Vec<PromptFileAttachment>> {
    let items: Vec<_> = files?
        .iter()
        .filter_map(|file| {
            let rest = file.uri.strip_prefix("data:")?;
            let (header, data) = rest.split_once(',')?;
            let mut parts = header.split(';');
            let mime = parts.next().unwrap_or_default();
            if !parts.any(|part| part.eq_ignore_ascii_case("base64")) {
                return None;
            }
            Some(PromptFileAttachment {
                data: PromptBase64(data.to_owned()),
                mime: if mime.is_empty() { "application/octet-stream".into() } else { mime.to_owned() },
                source: PromptFileSource::Inline(PromptFileSourceInline { r#type: "inline".into() }),
                name: file.name.clone(),
                description: file.description.clone(),
                mention: file.mention.clone(),
            })
        })
        .collect();
    (!items.is_empty()).then_some(items)
}

pub(crate) fn now() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0.0, |elapsed| elapsed.as_millis() as f64)
}

impl Data {
    /// Reads pending inbox items once per invalidation (`pending.sync`), reconciling events that
    /// overtook the response.
    pub fn pending_sync(&self, session: &SessionID) -> Task<()> {
        let session = session.clone();
        // Events after this call must reach the read's overtake log, so it opens before the read
        // is spawned.
        let register = {
            let session = session.clone();
            move |state: &mut State| {
                let token = state.token();
                // Ordered, as the TS `Map`: overtaking enqueues keep their arrival order.
                state.pending_updates.insert(session, (token, IndexMap::new()));
                (state.deletion_epoch, token)
            }
        };
        self.sync_start(format!("session.pending:{}", session.0), register, move |data, (started, token)| async move {
            let response =
                data.client().session_inbox_list(&SessionInboxListInput { session_id: session.clone() }).await;
            let response = match response {
                Ok(response) => response,
                Err(error) => {
                    data.write(|state| release_updates(state, &session, token));
                    return Err(evict_missing(&data, error));
                }
            };
            data.write(|state| {
                let updates = state
                    .pending_updates
                    .get(&session)
                    .filter(|(current, _)| *current == token)
                    .map(|(_, updates)| updates.clone())
                    .unwrap_or_default();
                release_updates(state, &session, token);
                if state.deleted_since(&session, started) {
                    return;
                }
                let mut current: IndexMap<String, SessionInboxInfo> =
                    response.into_iter().map(|item| (item.id().to_owned(), item)).collect();
                for (id, update) in updates {
                    match update {
                        PendingUpdate::Removed => {
                            current.shift_remove(&id);
                        }
                        PendingUpdate::Delivery(delivery) => {
                            if let Some(item) = current.get_mut(&id) {
                                item.set_delivery(delivery);
                            }
                        }
                        PendingUpdate::Item(item) => {
                            current.insert(id, *item);
                        }
                    }
                }
                let pending: Vec<_> = current.into_values().collect();
                // A positive read acknowledges admission even when its echo is delayed.
                for item in &pending {
                    state.outbox.remove(item.id());
                }
                // Compactions also coalesce by session, not just by the proposed ID.
                if pending.iter().any(|item| item.tag() == "compaction") {
                    let local: Vec<String> = state
                        .pending(&session)
                        .iter()
                        .filter(|item| item.tag() == "compaction")
                        .map(|item| item.id().to_owned())
                        .collect();
                    for id in local {
                        state.outbox.remove(&id);
                    }
                }
                // Keep optimistic rows still awaiting their echo: this read may have raced ahead
                // of an admission the server does not know yet.
                let inflight: Vec<_> =
                    state.pending(&session).iter().filter(|item| state.outbox.contains(item.id())).cloned().collect();
                let mut merged = pending;
                merged.extend(inflight);
                state.pending.insert(session.clone(), merged.clone());
                state.log.pending(&session);
                for item in &merged {
                    state.materialize(item);
                }
            });
            Ok(())
        })
    }

    pub fn pending_invalidate(&self, session: &SessionID) {
        self.write(|state| state.syncs.invalidate(&format!("session.pending:{}", session.0)));
    }

    /// Optimistic prompt admission: renders the prompt at once under a client-minted ID, then
    /// sends it; the durable `session.inbox.enqueued` echo upserts the same ID. A failure rolls
    /// back only rows this call admitted and the server has not acknowledged.
    pub fn prompt(&self, prompt: impl Into<Prompt>) -> Task<SessionInboxUser> {
        let prompt = prompt.into();
        let mut request = prompt.input;
        let session = request.session_id.clone();
        let id = request.id.clone().flatten().unwrap_or_else(|| SessionMessageID(opencode_api::id::message()));
        request.id = Some(Some(id.clone()));
        let fresh = self.write(|state| {
            // A retry may reuse an ID that is already rendered, and possibly durable.
            let fresh = !state.transcript(&session).is_some_and(|transcript| transcript.contains(id.as_str()))
                && !state.pending(&session).iter().any(|item| item.id() == id.as_str());
            if fresh {
                state.outbox.insert(id.0.clone());
                state.admit_local(SessionInboxInfo::User(SessionInboxUser {
                    id: id.clone(),
                    session_id: session.clone(),
                    time: SessionInboxUserTime { created: now() },
                    r#type: "user".into(),
                    delivery: request.delivery.clone().flatten().unwrap_or(SessionInboxDelivery::Steer),
                    payload: SessionInboxUserPayload {
                        text: request.text.clone(),
                        files: optimistic_files(request.files.as_ref()),
                        agents: request.agents.clone(),
                        skills: None,
                        metadata: request.metadata.clone(),
                    },
                }));
            }
            fresh
        });
        let prepare = prompt.prepare;
        self.send_admission(
            &session.clone(),
            prompt.gate,
            move |data| async move {
                if let Some(prepare) = prepare {
                    prepare().await?;
                }
                data.client().session_prompt(&request).await.map_err(Error::new)
            },
            move |state, result| {
                if result.is_err() && fresh && state.outbox.remove(id.as_str()) {
                    state.retract_local(&session, id.as_str());
                }
            },
            |_, _| {},
        )
    }

    /// Admits a compaction (`compact`). A second gesture while one is in flight returns the same
    /// request. The server may coalesce onto another ID; the response's ID then replaces the
    /// proposed row.
    pub fn compact(&self, session: &SessionID, model: Option<ModelRef>) -> Task<SessionInboxCompaction> {
        let id = SessionMessageID(opencode_api::id::message());
        let existing = self.write(|state| {
            if let Some(active) = state.compacting.get(session) {
                return Some(active.request.clone());
            }
            if !state.pending(session).iter().any(|item| item.tag() == "compaction") {
                state.outbox.insert(id.0.clone());
                state.admit_local(SessionInboxInfo::Compaction(SessionInboxCompaction {
                    id: id.clone(),
                    session_id: session.clone(),
                    time: SessionInboxUserTime { created: now() },
                    r#type: "compaction".into(),
                    delivery: SessionInboxDelivery::Steer,
                    payload: SessionInboxCompactionPayload {},
                }));
            }
            None
        });
        if let Some(request) = existing {
            return request;
        }
        let input = SessionCompactInput { session_id: session.clone(), id: Some(id.clone()), delivery: None };
        let target = session.clone();
        let proposed = id.clone();
        self.send_admission(
            session,
            None,
            move |data| async move {
                if let Some(model) = model {
                    data.client()
                        .session_switch_model(&SessionSwitchModelInput { session_id: input.session_id.clone(), model })
                        .await
                        .map_err(Error::new)?;
                }
                data.client().session_compact(&input).await.map_err(Error::new)
            },
            move |state, result| {
                let observed = state.compacting.remove(&target).map(|active| active.observed).unwrap_or_default();
                match result {
                    Ok(item) => {
                        state.outbox.remove(proposed.as_str());
                        if item.id != proposed {
                            state.remove_pending(&target, proposed.as_str());
                        }
                        let shown =
                            state.transcript(&target).is_some_and(|transcript| transcript.contains(item.id.as_str()));
                        if !observed.contains(item.id.as_str()) && !shown {
                            state.admit_local(SessionInboxInfo::Compaction(item.clone()));
                        }
                    }
                    Err(_) => {
                        if state.outbox.remove(proposed.as_str()) {
                            state.remove_pending(&target, proposed.as_str());
                        }
                    }
                }
            },
            move |state, request| {
                state
                    .compacting
                    .insert(session.clone(), Compacting { id, observed: HashSet::new(), request: request.clone() });
            },
        )
    }

    /// Sends one admission after the session's creation, the previous admission of the session,
    /// and `gate` (`sendAdmission`). `settle` runs under the store lock with the result; `register`
    /// runs under the same lock that spawns the request.
    pub(crate) fn send_admission<T, F, Fut>(
        &self,
        session: &SessionID,
        gate: Option<Gate>,
        send: F,
        settle: impl FnOnce(&mut State, &Result<T, Error>) + Send + 'static,
        register: impl FnOnce(&mut State, &Task<T>),
    ) -> Task<T>
    where
        T: Clone + Send + Sync + 'static,
        F: FnOnce(Data) -> Fut + Send + 'static,
        Fut: Future<Output = Result<T, Error>> + Send + 'static,
    {
        let mut state = self.lock();
        let created = state.creating.get(session).map(|(_, task)| task.clone());
        let previous = state.sending.get(session).map(|(_, task)| task.clone());
        let token = state.token();
        let data = self.clone();
        let id = session.clone();
        let request = self.spawn(async move {
            let ready = futures_util::future::try_join3(
                async move {
                    match gate {
                        Some(gate) => gate.await,
                        None => Ok(()),
                    }
                },
                async move {
                    match created {
                        Some(created) => created.await,
                        None => Ok(()),
                    }
                },
                async move {
                    // One failure does not block the next admission.
                    if let Some(previous) = previous {
                        let _ = previous.await;
                    }
                    Ok(())
                },
            )
            .await;
            let result = match ready {
                Ok(_) => send(data.clone()).await,
                Err(error) => Err(error),
            };
            data.write(|state| {
                settle(state, &result);
                if state.sending.get(&id).is_some_and(|(current, _)| *current == token) {
                    state.sending.remove(&id);
                }
            });
            result
        });
        let chain = request.clone().map(|result| result.map(|_| ())).boxed().shared();
        state.sending.insert(session.clone(), (token, chain));
        register(&mut state, &request);
        self.flush(&mut state);
        request
    }
}

fn release_updates(state: &mut State, session: &SessionID, token: u64) {
    if state.pending_updates.get(session).is_some_and(|(current, _)| *current == token) {
        state.pending_updates.remove(session);
    }
}
