//! Pending inbox items and optimistic prompt and compaction admission.

use std::collections::HashSet;

use indexmap::IndexMap;
use opencode_api::generated::*;

use crate::changes::Touched;
use crate::core::{Effect, List, Ticket};
use crate::messages::{MessageExt, from_event};
use crate::reads::{Read, SessionRead};
use crate::sessions::Life;
use crate::state::{Compacting, Error, SessionStatus, State};

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
    fn set_delivery(&mut self, delivery: SessionInboxDelivery);
    fn created(&self) -> f64;
}

impl InboxExt for SessionInboxInfo {
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
        self.time_created()
    }
}

impl State {
    /// Pending inbox items in admission order (`pending.list`).
    pub fn pending(&self, session: &(impl AsRef<str> + ?Sized)) -> &[SessionInboxInfo] {
        self.sessions.get(session.as_ref()).map(|session| session.pending.as_slice()).unwrap_or_default()
    }

    /// Pending user and synthetic inputs (`input.list`); compactions are control items.
    pub fn inputs(&self, session: &SessionID) -> Vec<&str> {
        self.pending(session)
            .iter()
            .filter(|item| !matches!(item, SessionInboxInfo::Compaction(_)))
            .map(SessionInboxInfo::id)
            .collect()
    }

    pub fn has_input(&self, session: &SessionID, inbox: &str) -> bool {
        self.pending(session).iter().any(|item| item.id() == inbox && !matches!(item, SessionInboxInfo::Compaction(_)))
    }

    /// `pending.status`: an execution's idle boundary promotes every pending steer at once, so a
    /// steer only waits behind work once the current execution has delivered input.
    pub fn pending_status(&self, session: &SessionID, inbox: &str) -> Option<PendingStatus> {
        let pending = self.pending(session);
        let item = pending.iter().find(|item| item.id() == inbox && matches!(item, SessionInboxInfo::User(_)))?;
        if item.delivery() == Some(&SessionInboxDelivery::Queue) {
            return Some(PendingStatus::Queued);
        }
        let messages = self.messages(session);
        let boundary = messages.iter().rposition(|item| matches!(item, SessionMessageInfo::Idle(_)));
        if self.status(session) == SessionStatus::Idle {
            let stranded = boundary.is_some_and(|at| item.created() <= messages[at].created());
            return Some(if stranded { PendingStatus::Stranded } else { PendingStatus::Starting });
        }
        let after = boundary.map_or(0, |at| at + 1);
        let delivered = messages[after..].iter().any(|entry| {
            matches!(entry, SessionMessageInfo::User(_)) && !pending.iter().any(|other| other.id() == entry.id())
        });
        Some(if delivered { PendingStatus::Steering } else { PendingStatus::Starting })
    }

    /// Upserts an admitted item into pending and, for user and synthetic items, the transcript
    /// (`admitLocal`). This reconciles a durable echo with its optimistic placeholder.
    pub(crate) fn admit_local(&mut self, item: SessionInboxInfo) {
        // A session the store found missing shows nothing, whatever arrives late (model O9).
        if self.is_missing(item.session_id()) {
            return;
        }
        let key = self.sessions.entry(item.session_id());
        let pending = &mut self.sessions[key].pending;
        match pending.iter().position(|entry| entry.id() == item.id()) {
            Some(at) => pending[at] = item.clone(),
            None => pending.push(item.clone()),
        }
        self.touch_key(key, Touched::PENDING);
        if !matches!(item, SessionInboxInfo::Compaction(_)) {
            self.materialize(&item);
        }
    }

    /// The transcript row of a user or synthetic inbox item (`materializeInboxMessage`).
    pub(crate) fn materialize(&mut self, item: &SessionInboxInfo) {
        let row = match item {
            SessionInboxInfo::User(item) => SessionMessageInfo::User(SessionMessageUser {
                id: item.id.clone(),
                r#type: tag::User,
                text: item.payload.text.clone(),
                files: item.payload.files.clone(),
                agents: item.payload.agents.clone(),
                skills: item.payload.skills.clone(),
                metadata: item.payload.metadata.clone(),
                time: item.time.clone(),
            }),
            SessionInboxInfo::Synthetic(item) => SessionMessageInfo::Synthetic(SessionMessageSynthetic {
                id: item.id.clone(),
                r#type: tag::Synthetic,
                text: item.payload.text.clone(),
                description: item.payload.description.clone(),
                metadata: item.payload.metadata.clone(),
                time: item.time.clone(),
            }),
            _ => return,
        };
        self.upsert_message(&SessionID::from(item.session_id()), row);
    }

    /// Removes an item from pending and the transcript (`retractLocal`).
    pub(crate) fn retract_local(&mut self, session: &SessionID, inbox: &str) {
        self.remove_pending(session, inbox);
        if let Some(transcript) = self.sessions.get_mut(session).and_then(|session| session.transcript.as_mut())
            && transcript.remove(inbox).is_some()
        {
            self.touch(session, Touched::SHAPE);
        }
    }

    pub(crate) fn remove_pending(&mut self, session: &SessionID, inbox: &str) {
        let Some(key) = self.sessions.key(session) else { return };
        let record = &mut self.sessions[key];
        if let Some((_, updates)) = &mut record.pending_read {
            updates.insert(inbox.to_owned(), PendingUpdate::Removed);
        }
        let before = record.pending.len();
        record.pending.retain(|item| item.id() != inbox);
        if record.pending.len() != before {
            self.touch_key(key, Touched::PENDING);
        }
    }

    fn update_pending(&mut self, session: &SessionID, inbox: &str, delivery: &SessionInboxDelivery) {
        let Some(key) = self.sessions.key(session) else { return };
        let record = &mut self.sessions[key];
        let position = record.pending.iter().position(|item| item.id() == inbox);
        if let Some((_, updates)) = &mut record.pending_read {
            let update = match position {
                Some(at) => {
                    let mut item = record.pending[at].clone();
                    item.set_delivery(delivery.clone());
                    PendingUpdate::Item(Box::new(item))
                }
                None => PendingUpdate::Delivery(delivery.clone()),
            };
            updates.insert(inbox.to_owned(), update);
        }
        let Some(at) = position else { return };
        let item = &mut record.pending[at];
        if item.delivery() == Some(delivery) {
            return;
        }
        item.set_delivery(delivery.clone());
        self.touch_key(key, Touched::PENDING);
    }

    fn observe(&mut self, session: &SessionID, inbox: &str) {
        if let Some(active) = self.sessions.get_mut(session).and_then(|session| session.compacting.as_mut()) {
            active.observed.insert(inbox.to_owned());
        }
    }

    pub(crate) fn on_inbox_enqueued(&mut self, event: &SessionInboxEnqueued) {
        let data = &event.data;
        let session = &data.session_id;
        self.outbox.remove(data.inbox_id.as_str());
        let Some(item) = inbox_item(event) else { return };
        if let Some((_, updates)) = self.sessions.get_mut(session).and_then(|session| session.pending_read.as_mut()) {
            updates.insert(item.id().to_owned(), PendingUpdate::Item(Box::new(item.clone())));
        }
        let compaction = matches!(item, SessionInboxInfo::Compaction(_));
        self.admit_local(item);
        if !compaction {
            return;
        }
        self.observe(session, data.inbox_id.as_str());
        let Some(active) = self.sessions.get(session).and_then(|session| session.compacting.as_ref()) else { return };
        let proposed = active.id.clone();
        if proposed != data.inbox_id && self.outbox.remove(proposed.as_str()) {
            self.remove_pending(session, proposed.as_str());
        }
    }

    pub(crate) fn on_inbox_enriched(&mut self, event: &SessionInboxEnriched) {
        let data = &event.data;
        let session = &data.session_id;
        self.outbox.remove(data.inbox_id.as_str());
        let created = self
            .pending(session)
            .iter()
            .find(|item| item.id() == data.inbox_id.as_str())
            .map(InboxExt::created)
            .unwrap_or(event.created);
        let Some(item) = enriched_item(event, created) else { return };
        if let Some((_, updates)) = self.sessions.get_mut(session).and_then(|session| session.pending_read.as_mut()) {
            updates.insert(item.id().to_owned(), PendingUpdate::Item(Box::new(item.clone())));
        }
        self.admit_local(item);
    }

    pub(crate) fn on_inbox_delivered(&mut self, event: &SessionInboxDelivered, effects: &mut Vec<Effect>) {
        let data = &event.data;
        let session = &data.session_id;
        let inbox = data.inbox_id.as_str();
        let admitted = self.has_input(session, inbox);
        let known = self.pending(session).iter().any(|item| item.id() == inbox)
            || self.transcript(session).is_some_and(|transcript| transcript.contains(inbox));
        self.remove_pending(session, inbox);
        self.observe(session, inbox);
        if admitted
            && let Some(transcript) = self.sessions.get_mut(session).and_then(|session| session.transcript.as_mut())
            && let Some(item) = transcript.get_mut(inbox)
        {
            item.set_created(event.created);
            transcript.move_last(inbox);
            self.created(session, inbox);
            self.touch(session, Touched::SHAPE);
        }
        // An item this client never saw admitted (its enqueue was lost in a reconnect) has no row to show: a synced
        // transcript reads its head again.
        let read = Read::Session(session.as_str(), SessionRead::Messages);
        if known || !self.has_read(read) {
            return;
        }
        self.invalidate(read);
        effects.push(Effect::Messages(session.clone()));
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
            r#type: tag::Compaction,
            id: data.input_id.clone().unwrap_or_else(|| from_event(&event.id)),
            metadata: None,
            time: SessionInboxUserTime { created: event.created },
            status: tag::Running,
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

/// The inbox item of an enqueue event: its item with the event's ID, session, and time.
fn inbox_item(event: &SessionInboxEnqueued) -> Option<SessionInboxInfo> {
    let mut value = serde_json::to_value(&event.data.item).ok()?;
    let object = value.as_object_mut()?;
    object.insert("id".into(), event.data.inbox_id.as_str().into());
    object.insert("sessionID".into(), event.data.session_id.as_str().into());
    object.insert("time".into(), serde_json::json!({ "created": event.created }));
    serde_json::from_value(value).ok()
}

fn enriched_item(event: &SessionInboxEnriched, created: f64) -> Option<SessionInboxInfo> {
    let mut value = serde_json::to_value(&event.data.payload).ok()?;
    let object = value.as_object_mut()?;
    object.insert("id".into(), event.data.inbox_id.as_str().into());
    object.insert("sessionID".into(), event.data.session_id.as_str().into());
    object.insert("type".into(), "user".into());
    object.insert("delivery".into(), event.data.delivery.as_str().into());
    object.insert("time".into(), serde_json::json!({ "created" }));
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
                source: PromptFileSource::Inline(PromptFileSourceInline { r#type: tag::Inline }),
                name: file.name.clone(),
                description: file.description.clone(),
                mention: file.mention.clone(),
            })
        })
        .collect();
    (!items.is_empty()).then_some(items)
}

/// `Date.now()`, on the sim's clock when it sets one.
pub(crate) fn now() -> f64 {
    opencode_util::time::now_ms() as f64
}

impl State {
    /// Begins a read of the pending inbox items of the session of `ticket`. Events after this must reach the read's overtake
    /// log, so it opens before the read is fetched.
    pub(crate) fn begin_pending(&mut self, ticket: Ticket) -> List {
        let read = self.token();
        let record = &mut self.sessions[ticket.session()];
        // Ordered, as the TS `Map`: overtaking enqueues keep their arrival order.
        record.pending_read = Some((read, IndexMap::new()));
        List { ticket, session: record.id.clone(), read, started: self.deletion_epoch }
    }

    /// Publishes the inbox read `read`, reconciling the events that overtook it.
    pub(crate) fn complete_pending(
        &mut self,
        list: List,
        result: Result<Vec<SessionInboxInfo>, Error>,
        effects: &mut Vec<Effect>,
    ) {
        let session = &list.session;
        let updates = release_updates(self, session, list.read);
        let response = match result {
            Ok(response) => response,
            Err(error) => return self.evict_missing(&error),
        };
        let updates = updates.unwrap_or_default();
        if self.deleted_since(session, list.started) {
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
            self.outbox.remove(item.id());
        }
        // Compactions also coalesce by session, not just by the proposed ID.
        if pending.iter().any(|item| matches!(item, SessionInboxInfo::Compaction(_))) {
            let local: Vec<String> = self
                .pending(session)
                .iter()
                .filter(|item| matches!(item, SessionInboxInfo::Compaction(_)))
                .map(|item| item.id().to_owned())
                .collect();
            for id in local {
                self.outbox.remove(&id);
            }
        }
        // Keep optimistic rows still awaiting their echo: this read may have raced ahead
        // of an admission the server does not know yet.
        let inflight: Vec<_> =
            self.pending(session).iter().filter(|item| self.outbox.contains(item.id())).cloned().collect();
        let mut merged = pending;
        merged.extend(inflight);
        // An item the read no longer lists was cancelled or delivered by an event this client missed (a
        // reconnect loses events): its row goes, and a synced transcript reads again for a delivered one.
        let listed: HashSet<&str> = merged.iter().map(SessionInboxInfo::id).collect();
        let dropped: Vec<String> = self
            .pending(session)
            .iter()
            .filter(|item| !listed.contains(item.id()))
            .map(|item| item.id().to_owned())
            .collect();
        let record = self.sessions.get_or_insert(session);
        let mut retracted = false;
        if let Some(transcript) = &mut record.transcript {
            for id in &dropped {
                retracted |= transcript.remove(id).is_some();
            }
        }
        record.pending = merged.clone();
        let read = Read::Session(session.as_str(), SessionRead::Messages);
        let reread = retracted && self.has_read(read);
        if retracted {
            self.touch(session, Touched::SHAPE);
        }
        if reread {
            self.invalidate(read);
        }
        self.touch(session, Touched::PENDING);
        for item in &merged {
            self.materialize(item);
        }
        if reread {
            effects.push(Effect::Messages(session.clone()));
        }
    }

    /// Renders a prompt at once under its client-minted ID, unless that ID is already rendered: a retry may reuse
    /// it, and it may be durable. True when it rendered it, so a failure may roll it back.
    pub(crate) fn admit_prompt(&mut self, request: &SessionPromptInput) -> bool {
        let session = &request.session_id;
        let Some(Some(id)) = &request.id else { return false };
        let fresh = !self.transcript(session).is_some_and(|transcript| transcript.contains(id.as_str()))
            && !self.pending(session).iter().any(|item| item.id() == id.as_str());
        if fresh {
            self.outbox.insert(id.0.clone());
            self.admit_local(SessionInboxInfo::User(SessionInboxUser {
                id: id.clone(),
                session_id: session.clone(),
                time: SessionInboxUserTime { created: now() },
                r#type: tag::User,
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
    }

    /// Renders a compaction under `id` unless one is pending. `Some` with the token of a compaction in flight, which
    /// a second gesture joins.
    pub(crate) fn admit_compaction(&mut self, session: &SessionID, id: &SessionMessageID) -> Option<u64> {
        if let Some(active) = self.sessions.get(session).and_then(|session| session.compacting.as_ref()) {
            return Some(active.token);
        }
        if !self.pending(session).iter().any(|item| matches!(item, SessionInboxInfo::Compaction(_))) {
            self.outbox.insert(id.0.clone());
            self.admit_local(SessionInboxInfo::Compaction(SessionInboxCompaction {
                id: id.clone(),
                session_id: session.clone(),
                time: SessionInboxUserTime { created: now() },
                r#type: tag::Compaction,
                delivery: SessionInboxDelivery::Steer,
                payload: SessionInboxCompactionPayload::default(),
            }));
        }
        None
    }

    /// Begins an admission to `session` (`sendAdmission`): it waits for the session's creation and for the admission
    /// before it. A compaction is recorded as in flight under the proposed ID `compaction`.
    pub(crate) fn begin_admission(&mut self, session: &SessionID, compaction: Option<SessionMessageID>) -> Admission {
        let key = self.sessions.entry(session);
        let token = self.token();
        let record = &mut self.sessions[key];
        let creating = match record.life {
            Life::Creating { token, .. } => Some(token),
            _ => None,
        };
        let previous = record.sending.replace(token);
        if let Some(id) = compaction {
            record.compacting = Some(Compacting { id, observed: HashSet::new(), token });
        }
        Admission { token, creating, previous }
    }

    /// Ends the prompt admission `token`: a failure rolls back the row it rendered (`fresh`) while the server has not
    /// acknowledged it.
    pub(crate) fn complete_prompt(
        &mut self,
        session: &SessionID,
        token: u64,
        id: &SessionMessageID,
        fresh: bool,
        failed: bool,
    ) {
        if failed && fresh && self.outbox.remove(id.as_str()) {
            self.retract_local(session, id.as_str());
        }
        self.end_admission(session, token);
    }

    /// Ends the compaction admission `token` that proposed `proposed`. The server may coalesce onto another ID; the
    /// response's ID then replaces the proposed row.
    pub(crate) fn complete_compaction(
        &mut self,
        session: &SessionID,
        token: u64,
        proposed: &SessionMessageID,
        result: Result<SessionInboxCompaction, Error>,
    ) {
        let active = self.sessions.get_mut(session).and_then(|session| session.compacting.take());
        let observed = active.map(|active| active.observed).unwrap_or_default();
        match result {
            Ok(item) => {
                self.outbox.remove(proposed.as_str());
                if item.id != *proposed {
                    self.remove_pending(session, proposed.as_str());
                }
                let shown = self.transcript(session).is_some_and(|transcript| transcript.contains(item.id.as_str()));
                if !observed.contains(item.id.as_str()) && !shown {
                    self.admit_local(SessionInboxInfo::Compaction(item));
                }
            }
            Err(_) => {
                if self.outbox.remove(proposed.as_str()) {
                    self.remove_pending(session, proposed.as_str());
                }
            }
        }
        self.end_admission(session, token);
    }

    fn end_admission(&mut self, session: &SessionID, token: u64) {
        if let Some(session) = self.sessions.get_mut(session) {
            session.sending.take_if(|current| *current == token);
        }
    }
}

/// An admission to send: its token, and the tokens of the creation and the admission it waits for.
pub(crate) struct Admission {
    pub(crate) token: u64,
    pub(crate) creating: Option<u64>,
    pub(crate) previous: Option<u64>,
}

/// Ends the inbox read `token`: the events that overtook it, while that read is still the current one.
fn release_updates(state: &mut State, session: &SessionID, token: u64) -> Option<IndexMap<String, PendingUpdate>> {
    let read = state.sessions.get_mut(session)?.pending_read.take_if(|(current, _)| *current == token);
    read.map(|(_, updates)| updates)
}

#[cfg(test)]
mod tests {
    /// Queued prompts and optimistic sessions take their time from the sim's fixed clock (`OPENCODE_DRIVE_NOW`). A
    /// process reads that once, so a child of this test binary sets it.
    #[test]
    fn local_times_read_the_sim_clock() {
        const FIXED: f64 = 1_600_000_000_000.0;
        if std::env::var_os("OPENCODE_RS_CLOCK_CHILD").is_none() {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "inbox::tests::local_times_read_the_sim_clock"])
                .env("OPENCODE_RS_CLOCK_CHILD", "1")
                .env("OPENCODE_DRIVE_NOW", (FIXED as i64).to_string())
                .output()
                .unwrap();
            let (stdout, stderr) = (String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
            assert!(output.status.success() && stdout.contains("1 passed"), "{stdout}\n{stderr}");
            return;
        }
        assert!((super::now() - FIXED).abs() < 60_000.0, "{}", super::now());
    }
}
