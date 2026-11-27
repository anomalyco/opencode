//! The store's requests: how each is fetched, what each effect starts, and the public methods that begin them.

use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;

use futures_util::FutureExt;
use futures_util::future::{BoxFuture, try_join_all};
use opencode_api::client::Client;
use opencode_api::generated::*;
use tokio_util::sync::CancellationToken;

use super::{Data, Remote, Task, Tasks};
use crate::core::{
    CatalogRead, Completion, Effect, Forms, Head, Info, Jobs, List, LocationRead, MessageRead, Projects, Restore,
    Shells,
};
use crate::forms::{Form, GLOBAL, form_read};
use crate::inbox::Admission;
use crate::location::{Catalog, Loaded, Location, SETTLE};
use crate::messages::{BRIDGE_PAGE_LIMITS, HeadPages, Page};
use crate::reads::{Read, ReadKey, SessionRead};
use crate::sessions::{CreateSession, Creation};
use crate::state::{Error, MESSAGE_PAGE, SessionStatus, State, is_tag};

/// Children per page of a family read (`CHILD_PAGE`).
const CHILD_PAGE: i64 = 200;

impl Data {
    /// Runs what an event or a completion asks for. Every read goes through `refresh`, which checks the connection
    /// before building it. A settle timer checks when it fires.
    pub(crate) fn run(&self, effects: Vec<Effect>) {
        for effect in effects {
            match effect {
                Effect::Session(id) => self.refresh(move |data| data.session_sync(&id, false)),
                Effect::Messages(id) => self.refresh(move |data| data.message_sync(&id)),
                Effect::Message(session, message) => self.fetch_message(session, message),
                Effect::Renamed(session, title) => self.renamed(session, title),
                Effect::Active(token) => self.rehydrate(token),
                Effect::Rehydrate => {
                    self.rehydrate_location();
                    let default = self.read(|state| state.default_location().clone());
                    self.refresh_catalogs(vec![Catalog::Vcs], default);
                    self.refresh(|data| data.project_sync());
                }
                Effect::Catalogs(catalogs, location) => self.refresh_catalogs(catalogs, location),
                Effect::Settle(catalog, location) => self.settle(catalog, location),
                Effect::Websearch(location) => self.refresh(move |data| data.websearch_refresh(Some(&location))),
                Effect::Jobs(root) => self.refresh(move |data| data.job_sync(&root)),
                Effect::Permissions(session) => self.refresh(move |data| data.permission_sync(&session)),
                Effect::Forms(owner, location) => self.refresh(move |data| data.form_sync(&owner, location.as_ref())),
                Effect::FormsReplied(owner, location) => drop(self.form_sync(&owner, Some(&location))),
            }
        }
    }

    /// Fetches `request` as a follow-up read, and completes it.
    fn follow(&self, request: impl Fetch) {
        let remote = self.remote();
        self.refresh(|_| async move {
            let completion = request.fetch(&remote).await;
            remote.call(move |data| data.finish(completion, |_| {})).await?
        });
    }
}

/// A request the driver fetches: its I/O, and the completion its answer makes, failed or not.
pub(super) trait Fetch: Send + 'static {
    fn fetch(self, remote: &Remote) -> impl Future<Output = Completion> + Send;
}

impl Fetch for Info {
    async fn fetch(self, remote: &Remote) -> Completion {
        let info = async {
            let info = remote.client().session_get(&SessionGetInput { session_id: self.id.clone() }).await;
            info.map_err(|error| (Arc::new(error), true))
        };
        let family = async {
            if !self.children {
                return Ok(Vec::new());
            }
            list_children(remote.client(), &self.id).await.map_err(|error| (error, false))
        };
        match futures_util::future::try_join(info, family).await {
            Ok(found) => Completion::Session(self, Ok(found), false),
            Err((error, evicts)) => Completion::Session(self, Err(error), evicts),
        }
    }
}

impl Fetch for Head {
    async fn fetch(self, remote: &Remote) -> Completion {
        let result = fetch_head(&self, remote).await;
        Completion::Messages(self, result)
    }
}

async fn fetch_head(head: &Head, remote: &Remote) -> Result<HeadPages, Error> {
    let input = MessageListInput {
        session_id: head.session.clone(),
        limit: Some(remote.head()),
        order: Some(MessageListInputOrder::Desc),
        ..Default::default()
    };
    let newest = remote.client().message_list(&input).await.map_err(Error::new)?;
    let mut data = newest.data;
    let mut next = newest.cursor.next.flatten();
    // More than one page arrived while its events were missed, so messages lie between the newest page and the
    // loaded history. Older pages close the gap; after a longer absence only the newest messages stay.
    for limit in BRIDGE_PAGE_LIMITS {
        let (Some(cursor), Some(first)) = (next.clone(), data.last().map(|item| item.id().to_owned())) else {
            break;
        };
        let check = head.clone();
        let gap = remote.call(move |store| store.read(|state| state.head_gap(&check, &first))).await?;
        let Some(oldest) = gap else { break };
        if data.iter().any(|item| item.id() == oldest) {
            break;
        }
        let input = MessageListInput {
            session_id: head.session.clone(),
            limit: Some(limit),
            cursor: Some(cursor),
            ..Default::default()
        };
        let page = remote.client().message_list(&input).await.map_err(Error::new)?;
        data.extend(page.data);
        next = page.cursor.next.flatten();
    }
    // A kept message that was still running may have changed while its events were missed.
    let unsettled = match data.last().map(|item| item.id().to_owned()) {
        Some(first) => {
            let check = head.clone();
            remote.call(move |store| store.read(|state| state.head_unsettled(&check, &first))).await?
        }
        None => Vec::new(),
    };
    let refreshed: HashMap<String, SessionMessageInfo> = try_join_all(unsettled.into_iter().map(|message_id| {
        let client = remote.client().clone();
        let session_id = head.session.clone();
        async move {
            let input = SessionMessageGetInput { session_id, message_id };
            match client.session_message_get(&input).await {
                Ok(item) => Ok(Some(item)),
                Err(error) if error.declared().is_some_and(|declared| declared.is::<MessageNotFoundError>()) => {
                    Ok(None)
                }
                Err(error) => Err(Error::new(error)),
            }
        }
    }))
    .await?
    .into_iter()
    .flatten()
    .map(|item| (item.id().to_owned(), item))
    .collect();
    Ok(HeadPages { data, next, refreshed })
}

impl Fetch for MessageRead {
    async fn fetch(self, remote: &Remote) -> Completion {
        let input = SessionMessageGetInput { session_id: self.session.clone(), message_id: self.message };
        let result = remote.client().session_message_get(&input).await.map_err(Error::new);
        Completion::Message { session: self.session, incarnation: self.incarnation, result }
    }
}

impl Fetch for Restore {
    async fn fetch(self, remote: &Remote) -> Completion {
        let input = SessionMessageGetInput { session_id: self.session.clone(), message_id: self.message.clone() };
        let result = remote.client().session_message_get(&input).await.map_err(Error::new);
        Completion::Restored { session: self.session, message: self.message, result }
    }
}

/// Pending inbox items, or pending permission requests, as its key says.
impl Fetch for List {
    async fn fetch(self, remote: &Remote) -> Completion {
        let session_id = self.session.clone();
        if matches!(self.ticket.key, ReadKey::Session(_, SessionRead::Pending)) {
            let result = remote.client().session_inbox_list(&SessionInboxListInput { session_id }).await;
            return Completion::Pending(self, result.map_err(Error::new));
        }
        let result = remote.client().permission_list(&PermissionListInput { session_id }).await;
        Completion::Permissions(self, result.map_err(Error::new))
    }
}

impl Fetch for Forms {
    async fn fetch(self, remote: &Remote) -> Completion {
        let result = match &self.form {
            (owner, location) if owner == GLOBAL => {
                let input = FormListInput { location: location.as_ref().and_then(Location::query) };
                remote.client().form_list(&input).await.map(|response| {
                    let at = Location::from(&response.location);
                    let list = response
                        .data
                        .into_iter()
                        .filter(|form| form.session_id == GLOBAL)
                        .map(|info| Form { info, location: Some(at.clone()) });
                    (list.collect(), Some(at))
                })
            }
            (owner, _) => {
                let input = SessionFormListInput { session_id: owner.clone() };
                let list = remote.client().session_form_list(&input).await;
                list.map(|list| (list.into_iter().map(|info| Form { info, location: None }).collect(), None))
            }
        };
        Completion::Forms(self, result.map_err(Error::new))
    }
}

impl Fetch for Jobs {
    async fn fetch(self, remote: &Remote) -> Completion {
        let input = ExperimentalJobListInput {
            session_id: Some(self.root.clone()),
            status: Some(JobStatus::Running),
            descendants: Some(true),
            ..ExperimentalJobListInput::default()
        };
        Completion::Jobs(self, remote.client().experimental_job_list(&input).await.map_err(Error::new))
    }
}

impl Fetch for CatalogRead {
    async fn fetch(self, remote: &Remote) -> Completion {
        let result = load(remote.client(), self.catalog, &self.location).await.map_err(Error::new);
        Completion::Catalog(self, result)
    }
}

impl Fetch for Shells {
    async fn fetch(self, remote: &Remote) -> Completion {
        let input = ShellListInput { location: self.location.query() };
        Completion::Shells(self, remote.client().shell_list(&input).await.map_err(Error::new))
    }
}

impl Fetch for LocationRead {
    async fn fetch(self, remote: &Remote) -> Completion {
        let input = LocationGetInput { location: self.location.query() };
        Completion::Location(self, remote.client().location_get(&input).await.map_err(Error::new))
    }
}

impl Fetch for Projects {
    async fn fetch(self, remote: &Remote) -> Completion {
        let result = remote.client().project_list(&ProjectListInput::default()).await.map_err(Error::new);
        Completion::Projects(self, result)
    }
}

/// Sessions.
impl Data {
    /// Reads a session once per invalidation (`session.sync`); with `children`, also every direct
    /// child, under its own key.
    pub fn session_sync(&self, id: &SessionID, children: bool) -> Task<()> {
        let read = if children { SessionRead::Family } else { SessionRead::Info };
        self.sync(Read::Session(id.as_str(), read), State::begin_session_read)
    }

    pub fn session_invalidate(&self, id: &SessionID) {
        self.write(|state| state.invalidate(Read::Session(id.as_str(), SessionRead::Info)));
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
        let mut store = self.lock();
        let Creation { id, token, fresh, input } = store.begin_creation(input);
        let remote = self.remote();
        let session = id.clone();
        let task = self.spawn(async move {
            let result = remote.client().session_create(&input).await.map_err(Error::new);
            let completion = Completion::Created { id: session, token, fresh, result: result.clone() };
            remote
                .call(move |data| {
                    data.complete(completion, |tasks| {
                        tasks.creations.remove(&token);
                    })
                })
                .await?;
            result
        });
        if fresh {
            store.tasks().creations.insert(token, task.clone().map(|result| result.map(|_| ())).boxed().shared());
        }
        self.flush(store);
        (id, task)
    }

    /// Applies a live title after the session's reads, so a racing read cannot overwrite it.
    fn renamed(&self, session: SessionID, title: String) {
        self.refresh(|data| {
            let family = data.read(|state| state.family_loading(&session));
            let own = data.session_sync(&session, false);
            let family = family.then(|| data.session_sync(&session, true));
            let remote = data.remote();
            async move {
                match family {
                    Some(family) => drop(futures_util::future::try_join(own, family).await?),
                    None => own.await?,
                }
                remote.call(move |data| data.complete(Completion::Renamed { session, title }, |_| {})).await
            }
        });
    }

    /// Reads the `session.active` snapshot of connection `token`.
    fn rehydrate(&self, token: u64) {
        let remote = self.remote();
        self.refresh(move |_| async move {
            let result = remote.client().session_active().await.map_err(Error::new);
            let failed = result.as_ref().err().cloned();
            remote.call(move |data| data.complete(Completion::Active(token, result), |_| {})).await?;
            failed.map_or(Ok(()), Err)
        });
    }
}

/// Every direct child, newest first, through every page (`listChildren`).
async fn list_children(client: &Client, parent: &SessionID) -> Result<Vec<SessionInfo>, Error> {
    let mut input = SessionListInput {
        parent_id: Some(Some(parent.clone())),
        order: Some(SessionListInputOrder::Desc),
        limit: Some(CHILD_PAGE),
        ..Default::default()
    };
    let mut children = Vec::new();
    loop {
        let page = client.session_list(&input).await.map_err(Error::new)?;
        let full = page.data.len() as i64 >= CHILD_PAGE;
        children.extend(page.data);
        let Some(next) = page.cursor.next.flatten().filter(|_| full) else { return Ok(children) };
        // Later pages carry only the cursor and the size, as in TS.
        input = SessionListInput { cursor: Some(next), limit: Some(CHILD_PAGE), ..Default::default() };
    }
}

/// Messages.
impl Data {
    /// Reads the newest transcript page once per invalidation. Merge concurrent events by `durable.seq`; see
    /// `State::publish_head`.
    pub fn message_sync(&self, session: &SessionID) -> Task<()> {
        self.sync(Read::Session(session.as_str(), SessionRead::Messages), State::begin_messages)
    }

    pub fn message_invalidate(&self, session: &SessionID) {
        self.write(|state| state.invalidate(Read::Session(session.as_str(), SessionRead::Messages)));
    }

    /// Follows a setting that changes while the client runs (`omitToolFileData` as a function): it applies to messages
    /// and events stored from now on. Turning it off does not bring back dropped payloads; see [`Data::restore_files`].
    pub fn set_omit_tool_file_data(&self, omit: bool) {
        self.lock().omit_file_data = omit;
    }

    /// Re-reads every loaded message whose tool file data was dropped, for a client that starts showing tool files
    /// (`message.restoreFiles`). Each session's messages are re-read one at a time, so many screenshots don't fan out
    /// at once.
    pub fn restore_files(&self) {
        for (session, ids) in self.read(State::dropped_files) {
            let remote = self.remote();
            self.runtime().spawn(async move {
                for message in ids {
                    let completion = Restore { session: session.clone(), message }.fetch(&remote).await;
                    let finished = remote.call(move |data| {
                        if let Err(error) = data.finish(completion, |_| {}) {
                            data.refresh_failed(&error);
                        }
                    });
                    if finished.await.is_err() {
                        return;
                    }
                }
            });
        }
    }

    /// Refetches one projected message and upserts it (the `session.model.selected` read). A response that
    /// arrives after the transcript was deleted, evicted or reverted publishes nothing (deviation
    /// O6-held-message-read).
    fn fetch_message(&self, session: SessionID, message: SessionMessageID) {
        let incarnation = self.read(|state| state.incarnation(&session));
        self.follow(MessageRead { session, message, incarnation });
    }

    /// Loads older pages (`message.loadMore`). Joins a load in flight; with `all`, it then
    /// continues to the oldest page.
    pub fn message_load_more(
        &self,
        session: &SessionID,
        options: LoadMore,
    ) -> impl Future<Output = Result<(), Error>> + Send + 'static {
        let (remote, session) = (self.remote(), session.clone());
        async move {
            if options.cancelled() {
                return Ok(());
            }
            loop {
                // One step on the owner: join the load in flight, or start one, so two callers start one load.
                let (session, step) = (session.clone(), options.clone());
                let next =
                    remote.call(move |data| data.loading(&session).ok_or_else(|| data.start_load(&session, step)));
                match next.await? {
                    Ok(pending) => {
                        if load_joined(pending, &options).await? {
                            return Ok(());
                        }
                    }
                    Err(Some(task)) => return task.await.map(|_| ()),
                    Err(None) => return Ok(()),
                }
            }
        }
    }

    /// The older-page load of `session` in flight.
    fn loading(&self, session: &SessionID) -> Option<Task<bool>> {
        self.read_tasks(|state, tasks| {
            let token = state.sessions.get(session)?.message_load?;
            Some(tasks.loads[&token].clone())
        })
    }

    /// Starts an older-page load from the current cursor, if any and not cancelled, and registers it for joiners.
    fn start_load(&self, session: &SessionID, options: LoadMore) -> Option<Task<bool>> {
        if options.cancelled() {
            return None;
        }
        let mut store = self.lock();
        let (token, page) = store.begin_older(session)?;
        let remote = self.remote();
        let id = session.clone();
        let task = self.spawn(async move {
            let cancel = options.cancel;
            let result = load_pages(&remote, &id, page, options.all, cancel.as_ref()).await;
            let ended = remote.call(move |data| {
                data.complete(Completion::OlderEnded { session: id, token }, |tasks| {
                    tasks.loads.remove(&token);
                })
            });
            ended.await?;
            match result {
                Err(_) if cancel.as_ref().is_some_and(CancellationToken::is_cancelled) => Ok(false),
                result => result,
            }
        });
        store.tasks().loads.insert(token, task.clone());
        self.flush(store);
        Some(task)
    }
}

/// Waits for a joined older-page load; whether the caller is done: cancelled, or a page was published and it does not
/// load them all.
async fn load_joined(pending: Task<bool>, options: &LoadMore) -> Result<bool, Error> {
    let published = match &options.cancel {
        None => pending.await?,
        Some(token) => tokio::select! {
            result = pending => match result {
                Ok(published) => published,
                Err(_) if token.is_cancelled() => return Ok(true),
                Err(error) => return Err(error),
            },
            _ = token.cancelled() => return Ok(true),
        },
    };
    Ok((!options.all && published) || options.cancelled())
}

/// Options of [`Data::message_load_more`].
#[derive(Debug, Clone, Default)]
pub struct LoadMore {
    /// Loads every older page in one publication.
    pub all: bool,
    /// Cancels the wait and the request (the TS `signal`).
    pub cancel: Option<CancellationToken>,
}

impl LoadMore {
    fn cancelled(&self) -> bool {
        self.cancel.as_ref().is_some_and(CancellationToken::is_cancelled)
    }
}

/// Publishes older pages once. If a refresh changes the cursor, restart from the new cursor to avoid a gap. Returns
/// false on cancellation before publication.
async fn load_pages(
    remote: &Remote,
    session: &SessionID,
    mut page: Page,
    all: bool,
    cancel: Option<&CancellationToken>,
) -> Result<bool, Error> {
    loop {
        let mut fetched = Vec::new();
        let mut next = Some(page.cursor.clone());
        while let Some(cursor) = next {
            let input = MessageListInput {
                session_id: session.clone(),
                limit: Some(if all { 200 } else { MESSAGE_PAGE }),
                cursor: Some(cursor),
                ..Default::default()
            };
            let request = remote.client().message_list(&input);
            let response = match cancel {
                None => request.await,
                Some(token) => tokio::select! {
                    response = request => response,
                    _ = token.cancelled() => return Ok(false),
                },
            }
            .map_err(Arc::new)?;
            if cancel.is_some_and(CancellationToken::is_cancelled) {
                return Ok(false);
            }
            fetched.extend(response.data);
            next = response.cursor.next.flatten();
            if !all {
                break;
            }
        }
        let session = session.clone();
        let moved = remote.call(move |data| {
            data.write(|state| {
                let moved = state.page_moved(&session, &page);
                state.complete(Completion::Older { session, page, fetched, next }, &mut Vec::new());
                moved
            })
        });
        match moved.await? {
            None => return Ok(true),
            Some(None) => return Ok(false),
            Some(Some(current)) => page = current,
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

/// Inbox.
impl Data {
    /// Reads pending inbox items once per invalidation (`pending.sync`), reconciling events that
    /// overtook the response.
    pub fn pending_sync(&self, session: &SessionID) -> Task<()> {
        self.sync(Read::Session(session.as_str(), SessionRead::Pending), State::begin_pending)
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
        let fresh = self.write(|state| state.admit_prompt(&request));
        let prepare = prompt.prepare;
        self.send_admission(
            &session.clone(),
            prompt.gate,
            None,
            move |client| async move {
                if let Some(prepare) = prepare {
                    prepare().await?;
                }
                client.session_prompt(&request).await.map_err(Error::new)
            },
            move |token, result| Completion::Prompted { session, token, id, fresh, failed: result.is_err() },
            |_, _, _| {},
        )
    }

    /// Admits a compaction (`compact`). A second gesture while one is in flight returns the same
    /// request. The server may coalesce onto another ID; the response's ID then replaces the
    /// proposed row.
    pub fn compact(&self, session: &SessionID, model: Option<ModelRef>) -> Task<SessionInboxCompaction> {
        let id = SessionMessageID(opencode_api::id::message());
        let existing = self.write_tasks(|state, tasks| {
            let token = state.admit_compaction(session, &id)?;
            Some(tasks.compactions[&token].clone())
        });
        if let Some(request) = existing {
            return request;
        }
        let input = SessionCompactInput { session_id: session.clone(), id: Some(id.clone()), delivery: None };
        let target = session.clone();
        self.send_admission(
            session,
            None,
            Some(id.clone()),
            move |client| async move {
                if let Some(model) = model {
                    client
                        .session_switch_model(&SessionSwitchModelInput { session_id: input.session_id.clone(), model })
                        .await
                        .map_err(Error::new)?;
                }
                client.session_compact(&input).await.map_err(Error::new)
            },
            move |token, result| Completion::Compacted { session: target, token, proposed: id, result: result.clone() },
            |tasks, token, request| {
                tasks.compactions.insert(token, request.clone());
            },
        )
    }

    /// Sends one admission after the session's creation, the previous admission of the session,
    /// and `gate` (`sendAdmission`); a compaction under its proposed ID `compaction`. The admission begins in the write
    /// that spawns the request, where `register` keeps its task, and `complete` turns its result into its completion.
    fn send_admission<T, F, Fut>(
        &self,
        session: &SessionID,
        gate: Option<Gate>,
        compaction: Option<SessionMessageID>,
        send: F,
        complete: impl FnOnce(u64, &Result<T, Error>) -> Completion + Send + 'static,
        register: impl FnOnce(&mut Tasks, u64, &Task<T>),
    ) -> Task<T>
    where
        T: Clone + Send + Sync + 'static,
        F: FnOnce(Client) -> Fut + Send + 'static,
        Fut: Future<Output = Result<T, Error>> + Send + 'static,
    {
        let mut store = self.lock();
        let Admission { token, creating, previous } = store.begin_admission(session, compaction);
        let created = creating.map(|creating| store.tasks().creations[&creating].clone());
        let previous = previous.map(|previous| store.tasks().sends[&previous].clone());
        let remote = self.remote();
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
                Ok(_) => send(remote.client().clone()).await,
                Err(error) => Err(error),
            };
            let completion = complete(token, &result);
            let completed = remote.call(move |data| {
                data.complete(completion, |tasks| {
                    tasks.sends.remove(&token);
                    tasks.compactions.remove(&token);
                })
            });
            completed.await?;
            result
        });
        let chain = request.clone().map(|result| result.map(|_| ())).boxed().shared();
        store.tasks().sends.insert(token, chain);
        register(store.tasks(), token, &request);
        self.flush(store);
        request
    }
}

/// Locations and their catalogs.
impl Data {
    fn resolve(&self, location: Option<&Location>) -> Location {
        location.cloned().unwrap_or_else(|| self.read(|state| state.default_location().clone()))
    }

    /// Reads a catalog once per invalidation. It publishes under the location the server
    /// answers with; model and provider reads also under the requested one.
    pub fn catalog_sync(&self, catalog: Catalog, location: Option<&Location>) -> Task<()> {
        let read = Read::Catalog(catalog, &self.resolve(location));
        match catalog {
            Catalog::Shell => self.sync(read, State::begin_shells),
            _ => self.sync(read, State::begin_catalog),
        }
    }

    pub fn catalog_invalidate(&self, catalog: Catalog, location: Option<&Location>) {
        let location = self.resolve(location);
        self.write(|state| state.invalidate(Read::Catalog(catalog, &location)));
    }

    /// Reads a location's running shells once per invalidation.
    pub fn shell_sync(&self, location: Option<&Location>) -> Task<()> {
        self.catalog_sync(Catalog::Shell, location)
    }

    /// Reads location info once per invalidation (`location.syncInfo`). A read of the default
    /// location adopts the server's directory as the default.
    pub fn location_sync_info(&self, location: Option<&Location>) -> Task<()> {
        let adopt = location.is_none();
        self.sync(Read::Location(&self.resolve(location)), move |state, ticket| state.begin_location(ticket, adopt))
    }

    /// Reads location info, then every catalog a session view shows (`location.sync`).
    pub fn location_sync(&self, location: Option<&Location>) -> Task<()> {
        let info = self.location_sync_info(location);
        let remote = self.remote();
        let requested = location.cloned();
        self.spawn(async move {
            info.await?;
            let reads = remote.call(move |data| data.location_reads(requested.as_ref())).await?;
            try_join_all(reads).await?;
            Ok(())
        })
    }

    /// Reads every catalog a session view shows, and the global forms, of `requested` or the default location.
    fn location_reads(&self, requested: Option<&Location>) -> Vec<Task<()>> {
        let location = self.resolve(requested);
        let mut reads: Vec<Task<()>> = [
            Catalog::Vcs,
            Catalog::Agent,
            Catalog::Command,
            Catalog::Integration,
            Catalog::McpServer,
            Catalog::McpResource,
            Catalog::Model,
            Catalog::Provider,
            Catalog::Reference,
            Catalog::Skill,
            Catalog::Shell,
        ]
        .into_iter()
        .map(|catalog| self.catalog_sync(catalog, Some(&location)))
        .collect();
        reads.push(self.form_sync(crate::forms::GLOBAL, Some(&location)));
        reads
    }

    /// Reads web search providers on every call; there is no cached read.
    pub fn websearch_refresh(&self, location: Option<&Location>) -> Task<()> {
        let location = self.resolve(location);
        let remote = self.remote();
        self.spawn(async move {
            let input = WebsearchProvidersInput { location: location.query() };
            let result = remote.client().websearch_providers(&input).await.map_err(Error::new);
            remote.call(move |data| data.finish(Completion::Websearch(result), |_| {})).await?
        })
    }

    /// `server.connected`: reads the default location's info without the sync key, as TS does.
    fn rehydrate_location(&self) {
        self.follow(LocationRead { ticket: None, location: self.resolve(None), adopt: false });
    }

    fn refresh_catalogs(&self, catalogs: Vec<Catalog>, location: Location) {
        self.refresh(|data| {
            let reads: Vec<Task<()>> =
                catalogs.into_iter().map(|catalog| data.catalog_sync(catalog, Some(&location))).collect();
            async move { try_join_all(reads).await.map(|_| ()) }
        });
    }

    /// Reads `catalog` once a burst of events that ask for it goes quiet for [`SETTLE`].
    fn settle(&self, catalog: Catalog, location: Location) {
        let remote = self.remote();
        let mut store = self.lock();
        let (key, token, previous) = store.begin_settle(catalog, &location);
        // A timer that fired before a later one replaced it settles nothing: the state keeps the later token.
        let handle = self.runtime().spawn(async move {
            tokio::time::sleep(SETTLE).await;
            remote
                .post(move |data| {
                    data.complete(Completion::Settled { key, token, catalog, location }, |tasks| {
                        tasks.timers.remove(&token);
                    })
                })
                .await;
        });
        store.tasks().timers.insert(token, handle.abort_handle());
        if let Some(previous) = previous.and_then(|previous| store.tasks().timers.remove(&previous)) {
            previous.abort();
        }
    }
}

/// Permissions, forms, jobs and projects.
impl Data {
    /// Reads pending permissions once per invalidation. Requests opened or settled during the read take precedence
    /// over its snapshot.
    pub fn permission_sync(&self, session: &SessionID) -> Task<()> {
        self.sync(Read::Session(session.as_str(), SessionRead::Permissions), State::begin_permissions)
    }

    /// Replies and drops the request; an already settled request counts as replied.
    pub fn permission_reply(
        &self,
        input: PermissionReplyInput,
    ) -> impl Future<Output = Result<(), Error>> + Send + 'static {
        let remote = self.remote();
        async move {
            if let Err(error) = remote.client().permission_reply(&input).await {
                let error = Error::new(error);
                if !is_tag(&error, "PermissionNotFoundError") {
                    return Err(error);
                }
            }
            let completion = Completion::PermissionReplied { session: input.session_id, request: input.request_id };
            remote.call(move |data| data.complete(completion, |_| {})).await
        }
    }

    /// Reads pending forms for a session or location. Forms created or settled during the read take precedence over
    /// its snapshot.
    pub fn form_sync(&self, owner: &str, location: Option<&Location>) -> Task<()> {
        let location = self.resolve(location);
        self.sync(form_read(owner, &location), State::begin_forms)
    }

    pub fn form_invalidate(&self, owner: &str, location: Option<&Location>) {
        self.write(|state| {
            let location = location.unwrap_or(state.default_location()).clone();
            state.invalidate(form_read(owner, &location));
        });
    }

    /// Answers a form and drops it. A form that is already settled counts as answered. A global
    /// form needs its location, which the request names in a header.
    pub fn form_reply(
        &self,
        input: SessionFormReplyInput,
        location: Option<&Location>,
    ) -> impl Future<Output = Result<(), Error>> + Send + 'static {
        let (remote, location) = (self.remote(), location.cloned());
        async move {
            let client = form_client(remote.client(), &input.session_id, location.as_ref());
            let result = client.session_form_reply(&input).await;
            settle_form(&remote, input.session_id, input.form_id, location, result).await
        }
    }

    /// Cancels a form and drops it; see [`Data::form_reply`].
    pub fn form_cancel(
        &self,
        input: SessionFormCancelInput,
        location: Option<&Location>,
    ) -> impl Future<Output = Result<(), Error>> + Send + 'static {
        let (remote, location) = (self.remote(), location.cloned());
        async move {
            let client = form_client(remote.client(), &input.session_id, location.as_ref());
            let result = client.session_form_cancel(&input).await;
            settle_form(&remote, input.session_id, input.form_id, location, result).await
        }
    }

    /// Reads the running jobs of the tree under `root` once per invalidation. Job events received during the read
    /// apply over its answer.
    pub fn job_sync(&self, root: &SessionID) -> Task<()> {
        self.sync(Read::Session(root.as_str(), SessionRead::Jobs), State::begin_jobs)
    }

    /// Cancels a running job, interrupting the work it started; a finished job stays finished.
    pub fn job_cancel(&self, id: &str) -> impl Future<Output = Result<(), Error>> + Send + 'static {
        let (client, input) = (self.client().clone(), ExperimentalJobCancelInput { id: id.to_owned() });
        async move { client.experimental_job_cancel(&input).await.map_err(Error::new) }
    }

    /// Reads every project once per invalidation; the read replaces the cached set.
    pub fn project_sync(&self) -> Task<()> {
        self.sync(Read::Projects, |_, ticket| Projects { ticket })
    }
}

/// Drops a form that a reply or a cancel settled; the owner's other forms are read again.
async fn settle_form(
    remote: &Remote,
    owner: String,
    id: FormID,
    location: Option<Location>,
    result: Result<(), opencode_api::error::Error>,
) -> Result<(), Error> {
    if let Err(error) = result {
        let settled = error.declared().is_some_and(|declared| {
            matches!(declared.tag.as_deref(), Some("FormNotFoundError" | "FormAlreadySettledError"))
                && declared.body.get("id").and_then(serde_json::Value::as_str) == Some(id.0.as_str())
        });
        if !settled {
            return Err(Error::new(error));
        }
    }
    remote.call(move |data| data.complete(Completion::FormReplied { owner, id, location }, |_| {})).await
}

/// Global forms name their location in a header (`formRequestOptions`).
fn form_client(client: &Client, owner: &str, location: Option<&Location>) -> Client {
    match (owner, location) {
        (GLOBAL, Some(location)) => {
            client.with_header("x-opencode-directory", opencode_api::js::encode_component(&location.directory))
        }
        _ => client.clone(),
    }
}

async fn load(
    client: &Client,
    catalog: Catalog,
    location: &Location,
) -> Result<(Location, Loaded), opencode_api::error::Error> {
    let query = location.query();
    Ok(match catalog {
        Catalog::Vcs => {
            let response = client.vcs_get(&VcsGetInput { location: query }).await?;
            ((&response.location).into(), Loaded::Vcs(response.data))
        }
        Catalog::UsageLimits => {
            let response = client.experimental_usage_limits(&ExperimentalUsageLimitsInput { location: query }).await?;
            ((&response.location).into(), Loaded::UsageLimits(response.data))
        }
        Catalog::Agent => {
            let response = client.agent_list(&AgentListInput { location: query }).await?;
            ((&response.location).into(), Loaded::Agent(response.data.into()))
        }
        Catalog::Command => {
            let response = client.command_list(&CommandListInput { location: query }).await?;
            ((&response.location).into(), Loaded::Command(response.data.into()))
        }
        // Config answers without a location; it publishes under the requested directory.
        Catalog::Config => {
            let entries = client.config_get(&ConfigGetInput { location: query }).await?;
            (Location::new(location.directory.clone()), Loaded::Config(entries.into()))
        }
        Catalog::Integration => {
            let response = client.integration_list(&IntegrationListInput { location: query }).await?;
            ((&response.location).into(), Loaded::Integration(response.data.into()))
        }
        Catalog::McpServer => {
            let response = client.mcp_list(&McpListInput { location: query }).await?;
            ((&response.location).into(), Loaded::McpServer(response.data.into()))
        }
        Catalog::McpResource => {
            let response = client.mcp_resource_catalog(&McpResourceCatalogInput { location: query }).await?;
            ((&response.location).into(), Loaded::McpResource(response.data.resources.into()))
        }
        Catalog::Model => {
            let response = client.model_list(&ModelListInput { location: query, types: None }).await?;
            ((&response.location).into(), Loaded::Model(response.data.into()))
        }
        Catalog::Provider => {
            let response = client.provider_list(&ProviderListInput { location: query }).await?;
            ((&response.location).into(), Loaded::Provider(response.data.into()))
        }
        Catalog::Reference => {
            let response = client.reference_list(&ReferenceListInput { location: query }).await?;
            ((&response.location).into(), Loaded::Reference(response.data.into()))
        }
        Catalog::Skill => {
            let response = client.skill_list(&SkillListInput { location: query }).await?;
            ((&response.location).into(), Loaded::Skill(response.data.into()))
        }
        Catalog::Shell => unreachable!("shells have their own request"),
    })
}
