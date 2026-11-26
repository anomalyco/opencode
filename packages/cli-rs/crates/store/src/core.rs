//! The store's two entry points over plain data: [`State::apply`] takes an event and [`State::complete`] the answer to
//! a request; both say what to read next as [`Effect`]s. A request begins under the store's owner, where a
//! `State::begin_*` registers what may overtake it and returns what to fetch; whoever runs the store fetches it and
//! hands the answer back as a [`Completion`]. Nothing here waits, locks or fetches.

use opencode_api::generated::*;

use crate::forms::{Form, FormRead};
use crate::location::{Catalog, Loaded, Location};
use crate::messages::{HeadPages, Page};
use crate::reads::ReadKey;
use crate::sessions::{Outcome, SessionKey};
use crate::state::{Error, State};

/// A keyed load in flight: the read, and the token of its load.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Ticket {
    pub(crate) key: ReadKey,
    pub(crate) token: u64,
}

/// The answer to a request, or to a mutation the driver ran. A keyed read's request comes back with its answer: its
/// `read` is the token of the overtake log or overlay that collected what overtook it, and its `started` the deletion
/// epoch it began at.
pub(crate) enum Completion {
    /// A failure of the session's own read (`evicts`), not its children's, may find it missing.
    Session(Info, Result<(SessionInfo, Vec<SessionInfo>), Error>, bool),
    /// This client's creation of session `id`, which admitted it when `fresh`.
    Created {
        id: SessionID,
        token: u64,
        fresh: bool,
        result: Result<SessionInfo, Error>,
    },
    /// A live title, once the session's reads that could overwrite it settled.
    Renamed {
        session: SessionID,
        title: String,
    },
    /// The `session.active` snapshot of connection `token`.
    Active(u64, Result<SessionActiveOutput, Error>),
    /// A follow-up read found the session missing.
    Missing(SessionID),
    Messages(Head, Result<HeadPages, Error>),
    Message {
        session: SessionID,
        incarnation: u64,
        result: Result<SessionMessageInfo, Error>,
    },
    Restored {
        session: SessionID,
        message: SessionMessageID,
        result: Result<SessionMessageInfo, Error>,
    },
    /// Older messages, oldest last, read from `page`, and the cursor after them.
    Older {
        session: SessionID,
        page: Page,
        fetched: Vec<SessionMessageInfo>,
        next: Option<String>,
    },
    /// The older-page load `token` ended.
    OlderEnded {
        session: SessionID,
        token: u64,
    },
    Pending(List, Result<Vec<SessionInboxInfo>, Error>),
    /// The prompt admission `token`, which rendered the row `id` when `fresh`.
    Prompted {
        session: SessionID,
        token: u64,
        id: SessionMessageID,
        fresh: bool,
        failed: bool,
    },
    /// The compaction admission `token`, which proposed `proposed`.
    Compacted {
        session: SessionID,
        token: u64,
        proposed: SessionMessageID,
        result: Result<SessionInboxCompaction, Error>,
    },
    Permissions(List, Result<Vec<PermissionRequest>, Error>),
    /// A permission request this client replied to, or found settled.
    PermissionReplied {
        session: SessionID,
        request: PermissionID,
    },
    /// Forms, and for global ones the location the server read them at.
    Forms(Forms, Result<(Vec<Form>, Option<Location>), Error>),
    /// A form this client answered or cancelled, or found settled.
    FormReplied {
        owner: String,
        id: FormID,
        location: Option<Location>,
    },
    Jobs(Jobs, Result<Vec<JobInfo>, Error>),
    /// A catalog, and the location the server answered with.
    Catalog(CatalogRead, Result<(Location, Loaded), Error>),
    Shells(Shells, Result<ShellListOutput, Error>),
    Location(LocationRead, Result<LocationPublicInfo, Error>),
    Websearch(Result<WebsearchProvidersOutput, Error>),
    /// The trailing refetch `token` of `catalog` at `location` fired.
    Settled {
        key: ReadKey,
        token: u64,
        catalog: Catalog,
        location: Location,
    },
    Projects(Projects, Result<Vec<Project>, Error>),
}

// The requests: what a `State::begin_*` says to fetch, with what its completion needs back. Each is its own type, so
// the task that fetches one holds only that request's I/O.

/// A read of a session's info, and of every direct child for `children`.
pub(crate) struct Info {
    pub(crate) ticket: Ticket,
    pub(crate) id: SessionID,
    pub(crate) children: bool,
    pub(crate) started: u64,
}

/// A read of the newest transcript page, in the transcript window `incarnation`.
#[derive(Clone)]
pub(crate) struct Head {
    pub(crate) ticket: Ticket,
    pub(crate) session: SessionID,
    pub(crate) read: u64,
    pub(crate) incarnation: u64,
}

/// A read of a list of a session that events change while it is read.
pub(crate) struct List {
    pub(crate) ticket: Ticket,
    pub(crate) session: SessionID,
    pub(crate) read: u64,
    pub(crate) started: u64,
}

/// A read of the forms of a session, or the global forms of a location.
pub(crate) struct Forms {
    pub(crate) ticket: Ticket,
    pub(crate) form: FormRead,
    pub(crate) read: u64,
    pub(crate) started: u64,
}

/// A read of the running jobs of the tree under `root`.
pub(crate) struct Jobs {
    pub(crate) ticket: Ticket,
    pub(crate) root: SessionID,
    pub(crate) read: u64,
}

pub(crate) struct CatalogRead {
    pub(crate) ticket: Ticket,
    pub(crate) catalog: Catalog,
    pub(crate) location: Location,
}

/// A read of the running shells of a location.
pub(crate) struct Shells {
    pub(crate) ticket: Ticket,
    pub(crate) location: Location,
    pub(crate) read: u64,
}

/// A read of location info, keyed or not; one of the default location `adopt`s the server's directory.
pub(crate) struct LocationRead {
    pub(crate) ticket: Option<Ticket>,
    pub(crate) location: Location,
    pub(crate) adopt: bool,
}

pub(crate) struct Projects {
    pub(crate) ticket: Ticket,
}

/// A read of one projected message, in the transcript window `incarnation`.
pub(crate) struct MessageRead {
    pub(crate) session: SessionID,
    pub(crate) message: SessionMessageID,
    pub(crate) incarnation: u64,
}

/// A read of one message whose tool file data was dropped.
pub(crate) struct Restore {
    pub(crate) session: SessionID,
    pub(crate) message: SessionMessageID,
}

impl Ticket {
    /// The session of a session read.
    pub(crate) fn session(self) -> SessionKey {
        let ReadKey::Session(key, _) = self.key else { unreachable!("a session read") };
        key
    }
}

/// A read an event or a completion asks for, started after the store's owner lets go of the state.
#[derive(Debug, Clone)]
pub(crate) enum Effect {
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
    /// A catalog read once a burst of events that ask for it goes quiet (already invalidated).
    Settle(Catalog, Location),
    /// The web search providers of a location.
    Websearch(Location),
    /// The running jobs of a synced tree (already invalidated).
    Jobs(SessionID),
    /// Pending permission requests, after an overflowed read (already invalidated).
    Permissions(SessionID),
    /// Forms of an owner, after an overflowed read (already invalidated).
    Forms(String, Option<Location>),
    /// The other forms of an owner one of whose forms this client settled (already invalidated): read at once, also
    /// offline, and a failure goes unreported.
    FormsReplied(String, Location),
}

/// A streaming delta, borrowed from its event, so it applies without an owned event. Deltas are not durable, and no
/// head read replays them.
#[derive(Clone, Copy)]
pub(crate) enum Delta<'a> {
    Text { session: &'a str, message: &'a str, delta: &'a str },
    Reasoning { session: &'a str, message: &'a str, delta: &'a str },
    ToolInput { session: &'a str, message: &'a str, tool: &'a str, delta: &'a str },
    Compaction { session: &'a str, text: &'a str },
}

impl<'a> Delta<'a> {
    /// The delta `event` is, if it is one.
    pub(crate) fn of(event: &'a V2Event) -> Option<Self> {
        Some(match event {
            V2Event::SessionTextDelta(event) => {
                let data = &event.data;
                Delta::Text {
                    session: data.session_id.as_str(),
                    message: data.assistant_message_id.as_str(),
                    delta: &data.delta,
                }
            }
            V2Event::SessionReasoningDelta(event) => {
                let data = &event.data;
                Delta::Reasoning {
                    session: data.session_id.as_str(),
                    message: data.assistant_message_id.as_str(),
                    delta: &data.delta,
                }
            }
            V2Event::SessionToolInputDelta(event) => {
                let data = &event.data;
                Delta::ToolInput {
                    session: data.session_id.as_str(),
                    message: data.assistant_message_id.as_str(),
                    tool: &data.id,
                    delta: &data.delta,
                }
            }
            V2Event::SessionCompactionDelta(event) => {
                Delta::Compaction { session: event.data.session_id.as_str(), text: &event.data.text }
            }
            _ => return None,
        })
    }
}

impl Completion {
    /// The keyed load it settles.
    fn ticket(&self) -> Option<Ticket> {
        Some(match self {
            Self::Session(read, ..) => read.ticket,
            Self::Messages(read, _) => read.ticket,
            Self::Pending(read, _) | Self::Permissions(read, _) => read.ticket,
            Self::Forms(read, _) => read.ticket,
            Self::Jobs(read, _) => read.ticket,
            Self::Catalog(read, _) => read.ticket,
            Self::Shells(read, _) => read.ticket,
            Self::Location(read, _) => return read.ticket,
            Self::Projects(read, _) => read.ticket,
            _ => return None,
        })
    }

    /// The error the request failed with.
    pub(crate) fn error(&self) -> Option<&Error> {
        match self {
            Self::Session(_, result, _) => result.as_ref().err(),
            Self::Created { result, .. } => result.as_ref().err(),
            Self::Active(_, result) => result.as_ref().err(),
            Self::Messages(_, result) => result.as_ref().err(),
            Self::Message { result, .. } | Self::Restored { result, .. } => result.as_ref().err(),
            Self::Pending(_, result) => result.as_ref().err(),
            Self::Compacted { result, .. } => result.as_ref().err(),
            Self::Permissions(_, result) => result.as_ref().err(),
            Self::Forms(_, result) => result.as_ref().err(),
            Self::Jobs(_, result) => result.as_ref().err(),
            Self::Catalog(_, result) => result.as_ref().err(),
            Self::Shells(_, result) => result.as_ref().err(),
            Self::Location(_, result) => result.as_ref().err(),
            Self::Websearch(result) => result.as_ref().err(),
            Self::Projects(_, result) => result.as_ref().err(),
            Self::Renamed { .. }
            | Self::Missing(_)
            | Self::Older { .. }
            | Self::OlderEnded { .. }
            | Self::Prompted { .. }
            | Self::PermissionReplied { .. }
            | Self::FormReplied { .. }
            | Self::Settled { .. } => None,
        }
    }
}

impl State {
    /// Applies the answer to a request, then settles the keyed load it ends.
    pub(crate) fn complete(&mut self, completion: Completion, effects: &mut Vec<Effect>) {
        let settles = completion.ticket().map(|ticket| (ticket, completion.error().is_none()));
        match completion {
            Completion::Session(read, result, evicts) => self.complete_session_read(read, result, evicts),
            Completion::Created { id, token, fresh, result } => self.complete_creation(&id, token, fresh, result),
            Completion::Renamed { session, title } => self.rename(&session, title),
            Completion::Active(token, result) => self.complete_active(token, result, effects),
            Completion::Missing(id) => self.mark_deleted(&id),
            Completion::Messages(read, result) => self.complete_messages(read, result, effects),
            Completion::Message { session, incarnation, result: Ok(item) } => {
                self.complete_message(&session, incarnation, item)
            }
            Completion::Restored { session, message, result: Ok(item) } => self.restore_files(&session, &message, item),
            Completion::Older { session, page, fetched, next } => self.complete_older(&session, &page, fetched, next),
            Completion::OlderEnded { session, token } => self.end_older(&session, token),
            Completion::Pending(read, result) => self.complete_pending(read, result, effects),
            Completion::Prompted { session, token, id, fresh, failed } => {
                self.complete_prompt(&session, token, &id, fresh, failed)
            }
            Completion::Compacted { session, token, proposed, result } => {
                self.complete_compaction(&session, token, &proposed, result)
            }
            Completion::Permissions(read, result) => self.complete_permissions(read, result, effects),
            Completion::PermissionReplied { session, request } => self.remove_permission(&session, &request),
            Completion::Forms(read, result) => self.complete_forms(read, result, effects),
            Completion::FormReplied { owner, id, location } => self.complete_form_reply(owner, &id, location, effects),
            Completion::Jobs(read, result) => self.complete_jobs(read, result, effects),
            Completion::Catalog(read, Ok((at, loaded))) => self.complete_catalog(read, at, loaded),
            Completion::Shells(read, Ok(response)) => self.complete_shells(read, response, effects),
            Completion::Location(read, Ok(info)) => self.complete_location(read.adopt, info),
            Completion::Websearch(Ok(providers)) => {
                self.location_mut(&Location::from(&providers.location), crate::changes::Parts::WEBSEARCH).websearch =
                    Some(providers.data);
            }
            Completion::Settled { key, token, catalog, location } => {
                self.complete_settle(key, token, catalog, location, effects)
            }
            Completion::Projects(_, Ok(projects)) => self.replace_projects(projects),
            // A failed read of these changes nothing but its keyed load.
            Completion::Message { .. }
            | Completion::Restored { .. }
            | Completion::Catalog(..)
            | Completion::Shells(..)
            | Completion::Location(..)
            | Completion::Websearch(_)
            | Completion::Projects(..) => {}
        }
        if let Some((ticket, ok)) = settles {
            self.settle_read(ticket.key, ticket.token, ok);
        }
    }
}

impl State {
    /// Applies one event (a `handleEvent` arm), and pushes the reads it asks for to `effects`.
    pub(crate) fn apply(&mut self, event: &V2Event, effects: &mut Vec<Effect>) {
        if let Some(delta) = Delta::of(event) {
            return self.apply_delta(delta);
        }
        self.event_seq = event.durable_seq();
        self.record_edit(event);
        match event {
            V2Event::ServerConnected(_) => {
                // Every connection after the first is a reconnect, also one the status watch
                // coalesced (`resync`, a queue-full drop): what the old stream left cached is
                // stale, and every view must look again.
                if self.connected {
                    for session in self.sessions.iter_mut() {
                        session.seal_anchor();
                    }
                    self.invalidate_all();
                } else {
                    // The first stream opens after the route reads, and the server does not replay what it sent
                    // before the subscription: a catalog read in that window can have missed the update that
                    // followed it, and a model list is empty until its providers settle. Only the catalogs are
                    // invalidated, since nothing else can be stale without a disconnect; the views look again.
                    self.invalidate_catalogs();
                }
                self.log.everything();
                self.connected = true;
                let token = self.token();
                self.active_updates = Some((token, Default::default()));
                effects.extend([Effect::Active(token), Effect::Rehydrate]);
                self.job_roots(effects);
            }
            V2Event::SessionCreated(event) => self.on_session_created(&event.data, effects),
            V2Event::SessionDeleted(event) => self.mark_deleted(&event.data.session_id),
            V2Event::SessionUsageUpdated(event) => self.on_usage_updated(&event.data),
            V2Event::SessionAgentSelected(event) => self.on_agent_selected(event),
            V2Event::SessionModelSelected(event) => self.on_model_selected(event, effects),
            V2Event::SessionRenamed(event) => {
                effects.push(Effect::Renamed(event.data.session_id.clone(), event.data.title.clone()));
            }
            V2Event::SessionPermissions(event) => self.on_permissions(&event.data),
            V2Event::SessionMetadataUpdated(event) => self.on_metadata(&event.data),
            V2Event::SessionArchived(event) => self.on_archived(&event.data.session_id, Some(event.created)),
            V2Event::SessionUnarchived(event) => self.on_archived(&event.data.session_id, None),
            V2Event::SessionMoved(event) => self.on_moved(event),
            V2Event::SessionInboxDelivered(event) => self.on_inbox_delivered(event, effects),
            V2Event::SessionInboxDeliveryChanged(event) => self.on_inbox_delivery_changed(&event.data),
            V2Event::SessionInboxCancelled(event) => self.on_inbox_cancelled(&event.data),
            V2Event::SessionInboxEnqueued(event) => self.on_inbox_enqueued(event),
            V2Event::SessionInstructionsUpdated(event) => {
                // The initial baseline and empty deltas carry no text and project no message.
                if let Some(text) = &event.data.text {
                    let keys: Vec<&str> = event.data.delta.keys().map(String::as_str).collect();
                    let row = SessionMessageSystem {
                        id: crate::messages::from_event(&event.id),
                        r#type: tag::System,
                        text: text.clone(),
                        description: Some(format!("Instructions updated: {}", keys.join(", "))),
                        metadata: event.metadata.clone(),
                        time: SessionInboxUserTime { created: event.created },
                    };
                    self.insert_message(&event.data.session_id, SessionMessageInfo::System(row));
                }
            }
            V2Event::SessionSynthetic(event) => {
                let row = SessionMessageSynthetic {
                    id: crate::messages::from_event(&event.id),
                    r#type: tag::Synthetic,
                    text: event.data.text.clone(),
                    description: event.data.description.clone(),
                    metadata: event.data.metadata.clone(),
                    time: SessionInboxUserTime { created: event.created },
                };
                self.insert_message(&event.data.session_id, SessionMessageInfo::Synthetic(row));
            }
            V2Event::SessionShellStarted(event) => self.on_shell_started(event),
            V2Event::SessionShellEnded(event) => self.on_shell_ended(event),
            V2Event::SessionStepStarted(event) => self.on_step_started(event),
            V2Event::SessionStepFirstToken(event) => self.on_step_first_token(event),
            V2Event::SessionStepStreamed(event) => self.on_step_streamed(event),
            V2Event::SessionStepEnded(event) => self.on_step_ended(event),
            V2Event::SessionStepFailed(event) => {
                self.on_step_failed(event);
                // A budget refusal means the cached usage limits are out of date, which is what
                // the refusal sends people to.
                let budget =
                    matches!(event.data.error.r#type.as_str(), "provider.budget-limit" | "provider.model-budget-limit");
                if let Some(location) = event.location.as_ref().filter(|_| budget) {
                    self.refresh_catalog(Catalog::UsageLimits, &Location::from(location), effects);
                }
            }
            V2Event::SessionTextStarted(event) => {
                self.on_text_started(&event.data.session_id, &event.data.assistant_message_id, event.data.ordinal)
            }
            V2Event::SessionTextEnded(event) => self.on_text_ended(&event.data),
            V2Event::SessionToolInputStarted(event) => self.on_tool_input_started(event),
            V2Event::SessionToolInputEnded(event) => self.on_tool_input_ended(&event.data),
            V2Event::SessionToolCalled(event) => self.on_tool_called(event),
            V2Event::SessionToolProgress(event) => self.on_tool_progress(&event.data),
            V2Event::SessionToolSuccess(event) => self.on_tool_success(event),
            V2Event::SessionToolFailed(event) => self.on_tool_failed(event),
            V2Event::SessionReasoningStarted(event) => self.on_reasoning_started(event),
            V2Event::SessionReasoningEnded(event) => self.on_reasoning_ended(event),
            V2Event::SessionRetryScheduled(event) => self.on_retry_scheduled(&event.data),
            V2Event::SessionExecutionStarted(event) => self.on_execution_started(&event.data.session_id, effects),
            V2Event::SessionCompactionStarted(event) => self.on_compaction_started(event),
            V2Event::SessionExecutionSucceeded(event) => {
                self.on_execution_ended(&event.id, event.created, &event.data.session_id, Outcome::Succeeded, effects)
            }
            V2Event::SessionExecutionFailed(event) => self.on_execution_ended(
                &event.id,
                event.created,
                &event.data.session_id,
                Outcome::Failed(&event.data.error),
                effects,
            ),
            V2Event::SessionExecutionInterrupted(event) => self.on_execution_ended(
                &event.id,
                event.created,
                &event.data.session_id,
                Outcome::Interrupted { shutdown: event.data.reason == SessionExecutionInterruptedDataReason::Shutdown },
                effects,
            ),
            V2Event::SessionViewed(event) => self.revalidate(&event.data.session_id, effects),
            V2Event::SessionRevertStaged(event) => self.on_revert_staged(&event.data),
            V2Event::SessionRevertCleared(event) => self.on_revert_cleared(&event.data.session_id),
            V2Event::SessionRevertCommitted(event) => self.on_revert_committed(&event.data),
            V2Event::SessionCompactionEnded(event) => self.on_compaction_ended(event),
            V2Event::SessionCompactionFailed(event) => self.on_compaction_failed_inbox(event),
            V2Event::PermissionAsked(event) => self.on_permission_asked(&event.data),
            V2Event::PermissionReplied(event) => self.remove_permission(&event.data.session_id, &event.data.request_id),
            V2Event::ProjectUpdated(event) => self.on_project_updated(&event.data),
            V2Event::WorktreeResolved(event) => self.on_worktree_resolved(&event.data, effects),
            V2Event::FormReplied(event) => {
                let location = event.location.as_ref().map(Location::from);
                self.remove_form(&event.data.session_id, &event.data.id, location.as_ref());
            }
            V2Event::FormCancelled(event) => {
                let location = event.location.as_ref().map(Location::from);
                self.remove_form(&event.data.session_id, &event.data.id, location.as_ref());
            }
            V2Event::ExperimentalJobUpdated(event) => self.on_job_updated(&event.data.info),
            _ => self.on_catalog_event(event, effects),
        }
    }
}
