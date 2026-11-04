//! Connection state and rehydration (F.7): applies event batches, reads what events leave
//! stale, and drives the store from F.3's connection loop.

use std::sync::atomic::Ordering;

use futures_util::StreamExt;
use futures_util::stream::BoxStream;
use opencode_api::client::{Client, RequestOptions};
use opencode_api::events::{self, Activity, Connection, Source, Status};
use opencode_api::generated::*;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use crate::location::{Catalog, Location};
use crate::sessions::Outcome;
use crate::state::{Data, Error, SessionStatus, State};

/// A read an event leaves for after the store lock is released.
#[derive(Debug, Clone)]
pub(crate) enum Follow {
    /// Session info (already invalidated).
    Session(SessionID),
    /// The newest message page (already invalidated).
    Messages(SessionID),
    /// One projected message.
    Message(SessionID, SessionMessageID),
    /// A live title to apply after the session reads.
    Renamed(SessionID, String),
    /// The `session.active` snapshot of connection `token`.
    Active(u64),
    /// The default location's info, its VCS, and the projects, after `server.connected`.
    Rehydrate,
    /// Catalogs of a location, read together (already invalidated).
    Catalogs(Vec<Catalog>, Location),
    /// A catalog read once a burst of events under the key goes quiet (already invalidated).
    Settle(String, Catalog, Location),
    /// The web search providers of a location.
    Websearch(Location),
}

impl Data {
    /// Applies one batch of events under one flush.
    pub fn apply(&self, events: &[V2Event]) {
        let follows: Vec<Follow> = {
            let mut state = self.lock();
            state.batch += 1;
            let follows = events
                .iter()
                .flat_map(|event| state.apply_event(event))
                .collect();
            state.batch -= 1;
            self.flush(&mut state);
            follows
        };
        for follow in follows {
            self.follow(follow);
        }
        for event in events.iter().filter(|event| is_signal(event)) {
            // No receiver is not an error: views subscribe when they need to.
            let _ = self.inner.signals.send(event.clone());
        }
    }

    /// Every read goes through `refresh`, which checks the connection before building it. A
    /// settle timer checks when it fires.
    fn follow(&self, follow: Follow) {
        match follow {
            Follow::Session(id) => self.refresh(move |data| data.session_sync(&id, false)),
            Follow::Messages(id) => self.refresh(move |data| data.message_sync(&id)),
            Follow::Message(session, message) => self.fetch_message(session, message),
            Follow::Renamed(session, title) => self.renamed(session, title),
            Follow::Active(token) => self.rehydrate(token),
            Follow::Rehydrate => {
                self.rehydrate_location();
                let default = self.read(|state| state.default_location().clone());
                self.refresh_catalogs(vec![Catalog::Vcs], default);
                self.refresh(|data| data.project_sync());
            }
            Follow::Catalogs(catalogs, location) => self.refresh_catalogs(catalogs, location),
            Follow::Settle(key, catalog, location) => self.settle(key, catalog, location),
            Follow::Websearch(location) => {
                self.refresh(move |data| data.websearch_refresh(Some(&location)))
            }
        }
    }

    /// Reconciles session status with `session.active`. Status events received during the read
    /// supersede the snapshot; a snapshot of an older connection is ignored.
    fn rehydrate(&self, token: u64) {
        self.refresh(move |data| async move {
            let result = data
                .client()
                .session_active(&RequestOptions::default())
                .await;
            let active = match result {
                Ok(active) => active,
                Err(error) => {
                    data.write(|state| {
                        if state
                            .active_updates
                            .as_ref()
                            .is_some_and(|(current, _)| *current == token)
                        {
                            state.active_updates = None;
                        }
                    });
                    return Err(Error::new(error));
                }
            };
            let unknown = data.write(|state| {
                let Some((current, updates)) = state.active_updates.take() else {
                    return Vec::new();
                };
                if current != token {
                    state.active_updates = Some((current, updates));
                    return Vec::new();
                }
                let mut snapshot: std::collections::HashMap<SessionID, SessionStatus> = active
                    .into_keys()
                    .map(|id| (SessionID(id), SessionStatus::Running))
                    .collect();
                for (id, status) in updates {
                    match status {
                        Some(status) => snapshot.insert(id, status),
                        None => snapshot.remove(&id),
                    };
                }
                let changed: Vec<SessionID> = state
                    .active
                    .keys()
                    .chain(snapshot.keys())
                    .filter(|id| state.active.get(*id) != snapshot.get(*id))
                    .cloned()
                    .collect();
                for id in &changed {
                    state.log.status(id);
                }
                state.active = snapshot;
                // Sessions created before this connection never delivered `session.created`;
                // without their info a running child never joins its root's family.
                state
                    .active
                    .iter()
                    .filter(|(id, status)| {
                        **status == SessionStatus::Running && !state.info.contains_key(*id)
                    })
                    .map(|(id, _)| id.clone())
                    .collect()
            });
            for id in unknown {
                data.refresh(move |data| data.session_sync(&id, false));
            }
            Ok(())
        });
    }

    /// Marks the connection up or down. Going down invalidates every cached read; the UI decides
    /// what to read again.
    pub fn set_online(&self, online: bool) {
        let was = self.inner.online.swap(online, Ordering::SeqCst);
        if was && !online {
            self.write(|state| state.syncs.invalidate_prefix(""));
        }
    }
}

impl State {
    /// One `handleEvent` arm; returns the reads it leaves for after the lock.
    pub(crate) fn apply_event(&mut self, event: &V2Event) -> Vec<Follow> {
        match event {
            V2Event::ServerConnected(_) => {
                // Every connection after the first is a reconnect, also one the status watch
                // coalesced (`resync`, a queue-full drop): what the old stream left cached is
                // stale, and every view must look again.
                if self.connected {
                    self.syncs.invalidate_prefix("");
                    self.log.everything();
                }
                self.connected = true;
                let token = self.token();
                self.active_updates = Some((token, Default::default()));
                return vec![Follow::Active(token), Follow::Rehydrate];
            }
            V2Event::SessionCreated(event) => return self.on_session_created(&event.data),
            V2Event::SessionDeleted(event) => self.mark_deleted(&event.data.session_id),
            V2Event::SessionUsageUpdated(event) => self.on_usage_updated(&event.data),
            V2Event::SessionAgentSelected(event) => self.on_agent_selected(event),
            V2Event::SessionModelSelected(event) => return self.on_model_selected(event),
            V2Event::SessionRenamed(event) => {
                return vec![Follow::Renamed(
                    event.data.session_id.clone(),
                    event.data.title.clone(),
                )];
            }
            V2Event::SessionPermissions(event) => self.on_permissions(&event.data),
            V2Event::SessionMetadataUpdated(event) => self.on_metadata(&event.data),
            V2Event::SessionArchived(event) => {
                self.on_archived(&event.data.session_id, Some(event.created))
            }
            V2Event::SessionUnarchived(event) => self.on_archived(&event.data.session_id, None),
            V2Event::SessionMoved(event) => self.on_moved(event),
            V2Event::SessionInboxDelivered(event) => self.on_inbox_delivered(event),
            V2Event::SessionInboxDeliveryChanged(event) => {
                self.on_inbox_delivery_changed(&event.data)
            }
            V2Event::SessionInboxCancelled(event) => self.on_inbox_cancelled(&event.data),
            V2Event::SessionInboxEnqueued(event) => self.on_inbox_enqueued(event),
            V2Event::SessionInstructionsUpdated(event) => {
                // The initial baseline and empty deltas carry no text and project no message.
                if let Some(text) = &event.data.text {
                    let keys: Vec<&str> = event.data.delta.keys().map(String::as_str).collect();
                    let row = SessionMessageSystem {
                        id: crate::messages::from_event(&event.id),
                        r#type: "system".into(),
                        text: text.clone(),
                        description: Some(format!("Instructions updated: {}", keys.join(", "))),
                        metadata: event.metadata.clone(),
                        time: SessionInboxUserTime {
                            created: event.created,
                        },
                    };
                    self.insert_message(&event.data.session_id, SessionMessageInfo::System(row));
                }
            }
            V2Event::SessionSynthetic(event) => {
                let row = SessionMessageSynthetic {
                    id: crate::messages::from_event(&event.id),
                    r#type: "synthetic".into(),
                    text: event.data.text.clone(),
                    description: event.data.description.clone(),
                    metadata: event.data.metadata.clone(),
                    time: SessionInboxUserTime {
                        created: event.created,
                    },
                };
                self.insert_message(&event.data.session_id, SessionMessageInfo::Synthetic(row));
            }
            V2Event::SessionShellStarted(event) => self.on_shell_started(event),
            V2Event::SessionShellEnded(event) => self.on_shell_ended(event),
            V2Event::SessionStepStarted(event) => self.on_step_started(event),
            V2Event::SessionStepStreamed(event) => self.on_step_streamed(event),
            V2Event::SessionStepEnded(event) => self.on_step_ended(event),
            V2Event::SessionStepFailed(event) => self.on_step_failed(event),
            V2Event::SessionTextStarted(event) => {
                self.on_text_started(&event.data.session_id, &event.data.assistant_message_id)
            }
            V2Event::SessionTextDelta(event) => self.on_text_delta(&event.data),
            V2Event::SessionTextEnded(event) => self.on_text_ended(&event.data),
            V2Event::SessionToolInputStarted(event) => self.on_tool_input_started(event),
            V2Event::SessionToolInputDelta(event) => self.on_tool_input_delta(&event.data),
            V2Event::SessionToolInputEnded(event) => self.on_tool_input_ended(&event.data),
            V2Event::SessionToolCalled(event) => self.on_tool_called(event),
            V2Event::SessionToolProgress(event) => self.on_tool_progress(&event.data),
            V2Event::SessionToolSuccess(event) => self.on_tool_success(event),
            V2Event::SessionToolFailed(event) => self.on_tool_failed(event),
            V2Event::SessionReasoningStarted(event) => self.on_reasoning_started(event),
            V2Event::SessionReasoningDelta(event) => self.on_reasoning_delta(&event.data),
            V2Event::SessionReasoningEnded(event) => self.on_reasoning_ended(event),
            V2Event::SessionRetryScheduled(event) => self.on_retry_scheduled(&event.data),
            V2Event::SessionExecutionStarted(event) => {
                return self.on_execution_started(&event.data.session_id);
            }
            V2Event::SessionCompactionStarted(event) => self.on_compaction_started(event),
            V2Event::SessionExecutionSucceeded(event) => {
                return self.on_execution_ended(
                    &event.id,
                    event.created,
                    &event.data.session_id,
                    Outcome::Succeeded,
                    None,
                    false,
                );
            }
            V2Event::SessionExecutionFailed(event) => {
                return self.on_execution_ended(
                    &event.id,
                    event.created,
                    &event.data.session_id,
                    Outcome::Failed,
                    Some(&event.data.error),
                    false,
                );
            }
            V2Event::SessionExecutionInterrupted(event) => {
                return self.on_execution_ended(
                    &event.id,
                    event.created,
                    &event.data.session_id,
                    Outcome::Interrupted,
                    None,
                    event.data.reason == SessionExecutionInterruptedDataReason::Shutdown,
                );
            }
            V2Event::SessionViewed(event) => return self.on_viewed(&event.data.session_id),
            V2Event::SessionRevertStaged(event) => self.on_revert_staged(&event.data),
            V2Event::SessionRevertCleared(event) => self.on_revert_cleared(&event.data.session_id),
            V2Event::SessionRevertCommitted(event) => self.on_revert_committed(&event.data),
            V2Event::SessionCompactionDelta(event) => self.on_compaction_delta(&event.data),
            V2Event::SessionCompactionEnded(event) => self.on_compaction_ended(event),
            V2Event::SessionCompactionFailed(event) => self.on_compaction_failed_inbox(event),
            V2Event::PermissionAsked(event) => self.on_permission_asked(&event.data),
            V2Event::PermissionReplied(event) => {
                self.remove_permission(&event.data.session_id, &event.data.request_id)
            }
            V2Event::ProjectUpdated(event) => self.on_project_updated(&event.data),
            V2Event::WorktreeResolved(event) => return self.on_worktree_resolved(&event.data),
            V2Event::FormReplied(event) => {
                let location = event.location.as_ref().map(Location::from);
                self.remove_form(&event.data.session_id, &event.data.id, location.as_ref());
            }
            V2Event::FormCancelled(event) => {
                let location = event.location.as_ref().map(Location::from);
                self.remove_form(&event.data.session_id, &event.data.id, location.as_ref());
            }
            _ => return self.on_catalog_event(event),
        }
        Vec::new()
    }
}

/// Drives the store from a connection: applies its batches and tracks whether it is connected.
/// Returns when the batch receiver closes.
pub async fn run(
    data: Data,
    mut state: watch::Receiver<events::State>,
    mut batches: mpsc::Receiver<Vec<V2Event>>,
) {
    let mut watching = true;
    loop {
        tokio::select! {
            biased;
            changed = state.changed(), if watching => {
                if changed.is_err() {
                    watching = false;
                    continue;
                }
                let online = state.borrow_and_update().status == Status::Connected;
                // F.3 queues the dying stream's last batch before it reports the disconnect.
                // Apply it while still online, so the invalidation below also covers it.
                if !online {
                    while let Ok(batch) = batches.try_recv() {
                        data.apply(&batch);
                    }
                }
                data.set_online(online);
            }
            batch = batches.recv() => {
                let Some(batch) = batch else {
                    return;
                };
                data.set_online(state.borrow().status == Status::Connected);
                data.apply(&batch);
            }
        }
    }
}

fn is_signal(event: &V2Event) -> bool {
    matches!(
        event,
        V2Event::TuiCommandExecute(_)
            | V2Event::TuiToastShow(_)
            | V2Event::TuiSessionSelect(_)
            | V2Event::TuiPromptAppend(_)
            | V2Event::SessionDeleted(_)
            | V2Event::SessionMoved(_)
            // The tab strip's prompt pulse (E.12).
            | V2Event::SessionInboxEnqueued(_)
            // The notifications plugin (E.19a).
            | V2Event::FormCreated(_)
            | V2Event::FormReplied(_)
            | V2Event::FormCancelled(_)
            | V2Event::PermissionAsked(_)
            | V2Event::PermissionReplied(_)
            | V2Event::SessionExecutionStarted(_)
            | V2Event::SessionExecutionSucceeded(_)
            | V2Event::SessionExecutionInterrupted(_)
            | V2Event::SessionExecutionFailed(_)
            // Terminal support and lists (E.13a).
            | V2Event::ServerConnected(_)
            | V2Event::PersistentPtyAdded(_)
            | V2Event::PersistentPtyRemoved(_)
            | V2Event::PersistentPtyUpdated(_)
            // Plugin RPC events, which the goal footer follows (E.14); it reads again on `server.connected`.
            | V2Event::Rpc(_)
    )
}

/// The `/api/event` stream of a client, for F.3's [`events::connect`].
pub struct Events {
    pub client: Client,
}

impl Source<V2Event> for Events {
    type Error = opencode_api::error::Error;

    fn open(&mut self, activity: Activity) -> BoxStream<'static, Result<V2Event, Self::Error>> {
        let client = self.client.clone();
        futures_util::stream::once(async move {
            client
                .event_subscribe(&EventSubscribeInput::default(), &RequestOptions::default())
                .await
                .map(|response| response.events(move || activity()).boxed())
        })
        .flat_map(|opened| match opened {
            Ok(stream) => stream,
            Err(error) => futures_util::stream::once(async move { Err(error) }).boxed(),
        })
        .boxed()
    }
}

/// Connects the store to its client's event stream on the store's runtime, so the UI thread can
/// call it without a runtime context. Drop the connection to stop.
pub fn connect(data: &Data, options: events::Options) -> (Connection, JoinHandle<()>) {
    let _runtime = data.runtime().enter();
    data.set_online(false);
    let (connection, batches) = events::connect(
        Events {
            client: data.client().clone(),
        },
        options,
    );
    let task = data
        .runtime()
        .spawn(run(data.clone(), connection.watch(), batches));
    (connection, task)
}
