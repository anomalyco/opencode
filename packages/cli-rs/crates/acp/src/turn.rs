//! Prompt turns: submission, event streaming, asks, cancellation, and child sessions that outlive a
//! turn (`packages/cli/src/acp/turn.ts`).
//!
//! A turn runs as its own task, so a cancelled prompt request still settles and responds. Cancellation
//! lands only while the turn waits on the server (`execute`) and in the last check of `settle`, as the
//! TS turn's interruptible regions do.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use futures_util::StreamExt;
use futures_util::future::BoxFuture;
use opencode_api::client::{Client, RequestOptions};
use opencode_api::generated::{
    PromptInputFileAttachment, SessionCommandInput, SessionCompactInput, SessionGetInput,
    SessionID, SessionInboxDelivery, SessionInterruptInput, SessionMessageID, SessionPromptInput,
    SessionSyntheticInput,
};
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot, watch};
use tokio_util::sync::CancellationToken;

use crate::capabilities::Capabilities;
use crate::catalog::{Catalogs, find_model};
use crate::child;
use crate::client::{check, classify, decode_session_id, event_type, subscribe};
use crate::config_option::current_model;
use crate::connection::{Connection, Responded};
use crate::elicitation;
use crate::error::Failure;
use crate::permission;
use crate::prompt::{self, Prepared};
use crate::sessions::{Attached, Sessions};
use crate::translate::{self, Folded, Output, StartKind, Terminal, TurnContext, TurnState};

/// Core acknowledges an interrupt before its cleanup settles, and its shell tool waits 3 s before SIGKILL.
pub const CANCEL_DRAIN_TIMEOUT: Duration = Duration::from_secs(5);

type Event = Result<Value, opencode_api::error::Error>;
type Job = BoxFuture<'static, ()>;

struct Subscription {
    /// Closing it ends the event stream and the ask worker.
    scope: CancellationToken,
    events: tokio::sync::Mutex<mpsc::UnboundedReceiver<Event>>,
    asks: mpsc::UnboundedSender<Job>,
    settled: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

#[derive(Clone)]
struct Turn {
    ctx: Arc<TurnContext>,
    state: Arc<Mutex<TurnState>>,
    subscription: Arc<Subscription>,
    /// Cancelled when the turn winds down; queued asks then answer with their fallback.
    cancelled: CancellationToken,
    background: bool,
}

/// How `execute` ended.
enum Exit {
    Done(Terminal),
    Interrupted,
    Failed(Failure),
}

struct Handle {
    serial: u64,
    cancel: CancellationToken,
    done: watch::Receiver<bool>,
}

pub struct Turns {
    client: Client,
    connection: Connection,
    sessions: Arc<Sessions>,
    catalogs: Arc<Catalogs>,
    capabilities: Arc<Mutex<Capabilities>>,
    turns: Mutex<HashMap<String, Handle>>,
    serial: AtomicU64,
    drain_timeout: Duration,
    scope: CancellationToken,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Turns {
    pub fn new(
        client: Client,
        connection: Connection,
        sessions: Arc<Sessions>,
        catalogs: Arc<Catalogs>,
        capabilities: Arc<Mutex<Capabilities>>,
        drain_timeout: Duration,
        scope: CancellationToken,
    ) -> Arc<Self> {
        Arc::new(Self {
            client,
            connection,
            sessions,
            catalogs,
            capabilities,
            turns: Mutex::default(),
            serial: AtomicU64::new(0),
            drain_timeout,
            scope,
        })
    }

    /// Registers and starts a turn. Runs before any other message is read, so concurrent prompts cannot
    /// both register and a cancel that follows always finds the turn. Cancelling `request` (a
    /// `$/cancel_request` for the prompt) cancels the turn like `session/cancel`.
    pub fn start(
        self: &Arc<Self>,
        session_id: String,
        content: Vec<Value>,
        request: &CancellationToken,
        responded: Responded,
    ) -> Result<oneshot::Receiver<Result<Value, Failure>>, Failure> {
        let mut turns = lock(&self.turns);
        if turns.contains_key(&session_id) {
            return Err(Failure::ServiceFailure {
                safe_message: format!("Session already has an active ACP prompt: {session_id}"),
                service: Some("session".to_owned()),
                error_name: None,
            });
        }
        let serial = self.serial.fetch_add(1, Ordering::Relaxed);
        let cancel = request.child_token();
        let (done_sender, done) = watch::channel(false);
        turns.insert(
            session_id.clone(),
            Handle {
                serial,
                cancel: cancel.clone(),
                done,
            },
        );
        drop(turns);
        let (result_sender, result) = oneshot::channel();
        let this = self.clone();
        tokio::spawn(async move {
            let response = this.run(&session_id, &content, &cancel).await;
            {
                let mut turns = lock(&this.turns);
                if turns
                    .get(&session_id)
                    .is_some_and(|handle| handle.serial == serial)
                {
                    turns.remove(&session_id);
                }
            }
            let _ = result_sender.send(response);
            // A cancel returns once the prompt's response is on the wire, so it reaches the client first.
            responded.wait().await;
            done_sender.send_replace(true);
        });
        Ok(result)
    }

    /// `session/cancel`: cancels the session's turn at once; the future resolves when its prompt has
    /// responded.
    pub fn cancel(&self, session_id: &str) -> BoxFuture<'static, ()> {
        let handle = lock(&self.turns).remove(session_id);
        let Some(handle) = handle else {
            return Box::pin(async {});
        };
        handle.cancel.cancel();
        let mut done = handle.done;
        Box::pin(async move {
            let _ = done.wait_for(|done| *done).await;
        })
    }

    /// Unlike `cancel`, interrupts an idle session too, since server work can outlive its turn.
    pub async fn close(&self, session_id: &str) -> Result<(), Failure> {
        if lock(&self.turns).contains_key(session_id) {
            self.cancel(session_id).await;
            return Ok(());
        }
        let Ok(id) = decode_session_id(session_id) else {
            return Ok(());
        };
        let result = self
            .client
            .session_interrupt(
                &SessionInterruptInput {
                    session_id: SessionID(id),
                    resume: None,
                },
                &RequestOptions::default(),
            )
            .await;
        match result {
            Err(error) if crate::client::is_declared(&error, "SessionNotFoundError") => Ok(()),
            result => check(result).map(|_| ()),
        }
    }

    async fn run(
        self: &Arc<Self>,
        session_id: &str,
        content: &[Value],
        cancel: &CancellationToken,
    ) -> Result<Value, Failure> {
        let attached = self.sessions.require(session_id)?;
        let prepared = prompt::prepare(&self.catalogs.get(&attached.cwd).await?, content).await?;
        let capabilities = *lock(&self.capabilities);
        let turn = self.open(TurnContext {
            session_id: attached.id.clone(),
            cwd: attached.cwd.clone(),
            start: prepared.start.clone(),
            child_updates: capabilities.child_session_updates,
            compaction: capabilities.compaction,
        });
        let exit = if cancel.is_cancelled() {
            Exit::Interrupted
        } else {
            self.execute(&attached, &prepared, &turn, cancel).await
        };
        self.handoff(&attached, &turn, &exit);
        let current = lock(&turn.state).clone();
        self.settle(&attached, &current, exit, cancel).await
    }

    // Parented to the agent scope; the session scope may already be closed.
    fn open(self: &Arc<Self>, ctx: TurnContext) -> Turn {
        let scope = self.scope.child_token();
        let (event_sender, events) = mpsc::unbounded_channel();
        let client = self.client.clone();
        let stream_scope = scope.clone();
        tokio::spawn(async move {
            let mut stream = subscribe(&client);
            loop {
                let event = tokio::select! {
                    event = stream.next() => event,
                    () = stream_scope.cancelled() => return,
                };
                let Some(event) = event else { return };
                let failed = event.is_err();
                if event_sender.send(event).is_err() || failed {
                    return;
                }
            }
        });
        let (asks, mut jobs) = mpsc::unbounded_channel::<Job>();
        let worker_scope = scope.clone();
        tokio::spawn(async move {
            loop {
                let job = tokio::select! {
                    job = jobs.recv() => job,
                    () = worker_scope.cancelled() => return,
                };
                let Some(job) = job else { return };
                tokio::select! {
                    () = job => {}
                    () = worker_scope.cancelled() => return,
                }
            }
        });
        Turn {
            ctx: Arc::new(ctx),
            state: Arc::new(Mutex::new(TurnState::default())),
            subscription: Arc::new(Subscription {
                scope,
                events: tokio::sync::Mutex::new(events),
                asks,
                settled: Mutex::default(),
            }),
            cancelled: CancellationToken::new(),
            background: false,
        }
    }

    async fn execute(
        self: &Arc<Self>,
        attached: &Attached,
        prepared: &Prepared,
        turn: &Turn,
        cancel: &CancellationToken,
    ) -> Exit {
        // The feed opens with `server.connected`, so every event the submission causes comes after it.
        let first = tokio::select! {
            event = take(&turn.subscription) => event,
            () = cancel.cancelled() => return Exit::Interrupted,
        };
        match first {
            Err(failure) => return Exit::Failed(failure),
            Ok(event) if event_type(&event) != "server.connected" => {
                return Exit::Failed(Failure::Defect {
                    name: Some("Error".to_owned()),
                    detail: format!("expected server.connected, got {}", event_type(&event)),
                });
            }
            Ok(_) => {}
        }
        let (result_sender, mut result) = watch::channel::<Option<Result<Terminal, Failure>>>(None);
        let this = self.clone();
        let consumer = turn.clone();
        let events = tokio::spawn(async move {
            let terminal = this.consume(&consumer).await;
            result_sender.send_replace(Some(terminal));
        });
        let abort = events.abort_handle();
        let _abort = AbortOnDrop(abort.clone());
        let mut joined = result.clone();
        let work = async {
            self.submit(attached, prepared).await?;
            if prepared.command.is_some() {
                return Ok(Terminal::Succeeded);
            }
            join(&mut joined).await
        };
        tokio::select! {
            outcome = work => match outcome {
                Ok(terminal) => Exit::Done(terminal),
                Err(failure) => Exit::Failed(failure),
            },
            () = cancel.cancelled() => {
                self.wind_down(turn, &mut result, &abort).await;
                Exit::Interrupted
            }
        }
    }

    async fn submit(&self, attached: &Attached, prepared: &Prepared) -> Result<(), Failure> {
        let session_id = || SessionID(attached.id.clone());
        let options = RequestOptions::default();
        if !prepared.synthetic.is_empty() {
            check(
                self.client
                    .session_synthetic(
                        &SessionSyntheticInput {
                            session_id: session_id(),
                            text: prepared.synthetic.join("\n\n"),
                            description: Some(Some("ACP embedded context".to_owned())),
                            delivery: Some(Some(SessionInboxDelivery::Steer)),
                            resume: Some(Some(false)),
                            ..SessionSyntheticInput::default()
                        },
                        &options,
                    )
                    .await,
            )?;
        }
        if prepared.start.kind == StartKind::Compaction {
            check(
                self.client
                    .session_compact(
                        &SessionCompactInput {
                            session_id: session_id(),
                            id: Some(SessionMessageID(prepared.start.id.clone())),
                            delivery: None,
                        },
                        &options,
                    )
                    .await,
            )?;
            return Ok(());
        }
        let files = Some(
            prepared
                .files
                .iter()
                .map(|file| PromptInputFileAttachment {
                    uri: file.uri.clone(),
                    name: file.name.clone(),
                    ..PromptInputFileAttachment::default()
                })
                .collect::<Vec<_>>(),
        );
        if let Some(command) = &prepared.command {
            return check(
                self.client
                    .session_command(
                        &SessionCommandInput {
                            session_id: session_id(),
                            name: command.name.clone(),
                            text: prepared
                                .slash
                                .as_ref()
                                .map(|slash| slash.args.clone())
                                .unwrap_or_default(),
                            files,
                            delivery: Some(Some(SessionInboxDelivery::Steer)),
                            ..SessionCommandInput::default()
                        },
                        &options,
                    )
                    .await,
            );
        }
        check(
            self.client
                .session_prompt(
                    &SessionPromptInput {
                        session_id: session_id(),
                        id: Some(Some(SessionMessageID(prepared.start.id.clone()))),
                        text: prepared.text.clone(),
                        files,
                        delivery: Some(Some(SessionInboxDelivery::Steer)),
                        ..SessionPromptInput::default()
                    },
                    &options,
                )
                .await,
        )
        .map(|_| ())
    }

    async fn wind_down(
        self: &Arc<Self>,
        turn: &Turn,
        result: &mut watch::Receiver<Option<Result<Terminal, Failure>>>,
        events: &tokio::task::AbortHandle,
    ) {
        turn.cancelled.cancel();
        if let Err(error) = self
            .client
            .session_interrupt(
                &SessionInterruptInput {
                    session_id: SessionID(turn.ctx.session_id.clone()),
                    resume: None,
                },
                &RequestOptions::default(),
            )
            .await
        {
            log::warn!(cause = error.to_string().as_str(); "ACP server interrupt failed");
        }
        if !lock(&turn.state).started {
            return;
        }
        if let Ok(Ok(())) =
            tokio::time::timeout(self.drain_timeout, async { join(result).await.map(|_| ()) }).await
        {
            return;
        }
        events.abort();
        let abandoned = {
            let mut state = lock(&turn.state);
            let abandoned = translate::abandon(&state, &turn.ctx);
            *state = abandoned.state.clone();
            abandoned
        };
        for output in abandoned.outputs {
            let _ = self.interpret(turn, output).await;
        }
    }

    fn handoff(self: &Arc<Self>, attached: &Arc<Attached>, turn: &Turn, exit: &Exit) {
        let close = turn.subscription.scope.clone();
        if matches!(exit, Exit::Failed(_)) {
            close.cancel();
            return;
        }
        let state = lock(&turn.state).clone();
        if state.open_children.is_empty() {
            close.cancel();
            return;
        }
        // Children outlive a cancelled turn, so their asks still reach the client.
        let background = Turn {
            ctx: turn.ctx.clone(),
            state: Arc::new(Mutex::new(state)),
            subscription: turn.subscription.clone(),
            cancelled: CancellationToken::new(),
            background: true,
        };
        let this = self.clone();
        let guard = close.clone().drop_guard();
        let work = async move {
            let _guard = guard;
            let _ = this.follow_children(&background).await;
        };
        if self.sessions.fork(attached, work).is_err() {
            close.cancel();
        }
    }

    async fn settle(
        &self,
        attached: &Attached,
        current: &TurnState,
        exit: Exit,
        cancel: &CancellationToken,
    ) -> Result<Value, Failure> {
        let terminal = match exit {
            Exit::Failed(failure) => return Err(failure),
            Exit::Done(terminal) => terminal,
            Exit::Interrupted => Terminal::Interrupted,
        };
        if terminal != Terminal::Interrupted
            && let Some(failure) = translate::failure(current)
        {
            return Err(failure);
        }
        if let Err(failure) = self.send_usage_update(attached, current).await {
            log::warn!(cause = failure.tag(); "ACP usage update failed");
        }
        let terminal = if cancel.is_cancelled() {
            Terminal::Interrupted
        } else {
            terminal
        };
        Ok(translate::response(current, &attached.id, terminal))
    }

    async fn send_usage_update(
        &self,
        attached: &Attached,
        state: &TurnState,
    ) -> Result<(), Failure> {
        let used = state.usage.map_or(0.0, |usage| usage.last.total());
        if used == 0.0 {
            return Ok(());
        }
        let catalog = self.catalogs.get(&attached.cwd).await?;
        let model = find_model(
            &catalog.models,
            &current_model(&catalog, &attached.selection()),
        );
        let Some(size) = model
            .map(|model| model.limit.context)
            .filter(|size| *size != 0)
        else {
            return Ok(());
        };
        let info = check(
            self.client
                .session_get(
                    &SessionGetInput {
                        session_id: SessionID(attached.id.clone()),
                    },
                    &RequestOptions::default(),
                )
                .await,
        )?;
        self.connection.session_update(
            &attached.id,
            json!({
                "sessionUpdate": "usage_update",
                "used": translate::number(used),
                "size": size,
                "cost": { "amount": translate::number(info.cost), "currency": "USD" },
            }),
        )
    }

    async fn advance(self: &Arc<Self>, turn: &Turn) -> Result<Folded, Failure> {
        let event = take(&turn.subscription).await?;
        let folded = {
            let mut state = lock(&turn.state);
            let folded = if turn.background && !translate::from_tracked_child(&state, &event) {
                Folded {
                    state: state.clone(),
                    outputs: Vec::new(),
                    terminal: None,
                }
            } else {
                translate::fold(&state, &event, &turn.ctx)
            };
            *state = folded.state.clone();
            folded
        };
        for output in folded.outputs.iter().cloned() {
            self.interpret(turn, output).await?;
        }
        Ok(folded)
    }

    async fn consume(self: &Arc<Self>, turn: &Turn) -> Result<Terminal, Failure> {
        loop {
            let folded = self.advance(turn).await?;
            if let Some(terminal) = folded.terminal {
                asks_settled(&turn.subscription).await;
                return Ok(terminal);
            }
        }
    }

    async fn follow_children(self: &Arc<Self>, turn: &Turn) -> Result<(), Failure> {
        loop {
            let folded = self.advance(turn).await?;
            if folded.state.open_children.is_empty() {
                asks_settled(&turn.subscription).await;
                return Ok(());
            }
        }
    }

    async fn interpret(self: &Arc<Self>, turn: &Turn, output: Output) -> Result<(), Failure> {
        match output {
            Output::SessionUpdate { update, diff } => {
                if turn.background {
                    return Ok(());
                }
                let update =
                    permission::with_completed_diffs(update, diff.as_ref(), &turn.ctx.cwd).await;
                self.connection.session_update(&turn.ctx.session_id, update)
            }
            Output::ChildUpdate { mut update, diff } => {
                if update.get("type").and_then(Value::as_str) == Some("update")
                    && let Some(inner) = update.get("update").cloned()
                {
                    let enriched =
                        permission::with_completed_diffs(inner, diff.as_ref(), &turn.ctx.cwd).await;
                    if let Some(object) = update.as_object_mut() {
                        object.insert("update".to_owned(), enriched);
                    }
                }
                if let Err(failure) = self.connection.notify(child::UPDATE_METHOD, update) {
                    log::warn!(cause = failure.tag(); "ACP child session update failed");
                }
                Ok(())
            }
            Output::PermissionAsk { event, tool, child } => {
                let data = event.get("data").cloned().unwrap_or(Value::Null);
                let id = data
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                let input = Arc::new(permission::Input {
                    client: self.client.clone(),
                    connection: self.connection.clone(),
                    session_id: data
                        .get("sessionID")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned(),
                    event,
                    client_session_id: turn.ctx.session_id.clone(),
                    cwd: turn.ctx.cwd.clone(),
                    tool,
                    child,
                });
                let asking = input.clone();
                queue_ask(
                    turn,
                    id,
                    Box::pin(async move { permission::ask(&asking).await }),
                    "reject".to_owned(),
                    move |decision| {
                        Box::pin(async move { permission::respond(&input, &decision).await })
                    },
                );
                Ok(())
            }
            Output::FormAsk { form, child } => {
                let capabilities = *lock(&self.capabilities);
                let Some(requested_schema) = elicitation::requested_schema(&form, &capabilities)
                else {
                    elicitation::cancel_unshown(&self.client, &form).await;
                    return Ok(());
                };
                let id = form
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                let tool_call_sent =
                    !turn.background && (child.is_none() || !turn.ctx.child_updates);
                let input = Arc::new(elicitation::Input {
                    client: self.client.clone(),
                    connection: self.connection.clone(),
                    form,
                    requested_schema,
                    client_session_id: turn.ctx.session_id.clone(),
                    child,
                    tool_call_sent,
                });
                let asking = input.clone();
                queue_ask(
                    turn,
                    id,
                    Box::pin(async move { elicitation::ask(&asking).await }),
                    elicitation::Outcome::Cancel,
                    move |outcome| {
                        Box::pin(async move { elicitation::respond(&input, outcome).await })
                    },
                );
                Ok(())
            }
            Output::AskSettled { id } => {
                if let Some(settled) = lock(&turn.subscription.settled).remove(&id) {
                    let _ = settled.send(());
                }
                Ok(())
            }
        }
    }
}

struct AbortOnDrop(tokio::task::AbortHandle);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

async fn join(
    result: &mut watch::Receiver<Option<Result<Terminal, Failure>>>,
) -> Result<Terminal, Failure> {
    match result.wait_for(Option::is_some).await {
        Ok(value) => value.clone().unwrap_or(Err(Failure::ServerUnavailable)),
        Err(_) => Err(Failure::ServerUnavailable),
    }
}

async fn take(subscription: &Subscription) -> Result<Value, Failure> {
    match subscription.events.lock().await.recv().await {
        Some(Ok(event)) => Ok(event),
        Some(Err(error)) => Err(classify(&error)),
        None => Err(Failure::ServerUnavailable),
    }
}

async fn asks_settled(subscription: &Subscription) {
    let (sender, receiver) = oneshot::channel();
    if subscription
        .asks
        .send(Box::pin(async move {
            let _ = sender.send(());
        }))
        .is_err()
    {
        return;
    }
    let _ = receiver.await;
}

fn queue_ask<A: Send + 'static>(
    turn: &Turn,
    id: String,
    ask: BoxFuture<'static, Result<A, Failure>>,
    fallback: A,
    respond: impl FnOnce(A) -> BoxFuture<'static, Result<(), Failure>> + Send + 'static,
) {
    let (settled_sender, settled) = oneshot::channel();
    lock(&turn.subscription.settled).insert(id, settled_sender);
    let cancelled = turn.cancelled.clone();
    let job = async move {
        // Checked in order, so an earlier cancel never starts the ask.
        let outcome = tokio::select! {
            biased;
            () = cancelled.cancelled() => Some(fallback),
            _ = settled => None,
            asked = ask => match asked {
                Ok(outcome) => Some(outcome),
                Err(failure) => {
                    if matches!(failure, Failure::Defect { .. }) {
                        log::warn!(cause = failure.tag(); "ACP ask failed");
                    }
                    Some(fallback)
                }
            },
        };
        let Some(outcome) = outcome else { return };
        // The reply finishes even when the subscription closes (TS: uninterruptible).
        let reply = tokio::spawn(respond(outcome));
        if let Ok(Err(failure)) = reply.await {
            log::warn!(cause = failure.tag(); "ACP ask reply failed");
        }
    };
    let _ = turn.subscription.asks.send(Box::pin(job));
}
