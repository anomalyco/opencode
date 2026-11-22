//! Applies event batches and refreshes reads invalidated by events or reconnection.

use std::sync::atomic::Ordering;

use futures_util::StreamExt;
use futures_util::stream::BoxStream;
use opencode_api::client::Client;
use opencode_api::events::{self, Activity, Connection, Source, Status};
use opencode_api::generated::*;
use opencode_api::transport::BoxFuture;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use crate::core::Delta;
use crate::driver::Data;
use crate::state::State;

impl Data {
    /// Applies one batch of events under one flush.
    pub fn apply(&self, events: &[V2Event]) {
        let mut effects = Vec::new();
        let kept = {
            let mut state = self.lock();
            state.batch += 1;
            for event in events {
                state.apply(event, &mut effects);
            }
            state.batch -= 1;
            // The batch's deltas, the hot path, are kept only while someone takes them, and all before the revision
            // that has them, so a sync it wakes takes them all.
            let kept = self.keep_deltas(events.iter().filter(|event| Delta::of(event).is_some()));
            self.flush(&mut state);
            kept
        };
        self.run(effects);
        // Each other event of a type someone listens to: of its kind, and of its name for a named kind.
        for event in events.iter().filter(|event| Delta::of(event).is_none()) {
            let kind = event.kind();
            if self.inner.listened[kind as usize].load(std::sync::atomic::Ordering::SeqCst) > 0
                && (!kind.named() || opencode_util::lock(&self.inner.named).contains_key(event.tag()))
            {
                // No receiver is not an error: views subscribe when they need to.
                let _ = self.inner.signals.send(std::sync::Arc::new(event.clone()));
            }
        }
        // A delta of a session whose messages are not loaded changes nothing, and is kept all the same.
        if kept {
            self.wake_deltas();
        }
    }

    /// Marks the connection up or down. Going down invalidates every cached read; the UI decides
    /// what to read again.
    pub fn set_online(&self, online: bool) {
        let was = self.inner.online.swap(online, Ordering::SeqCst);
        if was && !online {
            self.write(State::invalidate_all);
        }
    }
}

/// Drives the store from a connection: applies its batches and tracks whether it is connected.
/// Returns when the batch receiver closes.
pub async fn run(data: Data, mut state: watch::Receiver<events::State>, mut batches: mpsc::Receiver<Vec<V2Event>>) {
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
                // Apply the final queued batch while still online so disconnect invalidation covers it.
                if !online {
                    while let Ok(batch) = batches.try_recv() {
                        data.apply(&batch);
                    }
                }
                data.set_online(online);
            }
            batch = batches.recv() => {
                let Some(batch) = batch else { return };
                data.set_online(state.borrow().status == Status::Connected);
                data.apply(&batch);
            }
        }
    }
}

pub struct Events {
    pub client: Client,
}

impl Source<V2Event> for Events {
    /// The error as TS's connection records it: a declared error's message, else the client error's text.
    type Error = String;

    fn open(&mut self, activity: Activity) -> BoxStream<'static, Result<V2Event, Self::Error>> {
        let client = self.client.clone();
        futures_util::stream::once(async move {
            client
                .event_subscribe(&EventSubscribeInput::default())
                .await
                .map(|response| response.events(move || activity()).boxed())
        })
        .flat_map(|opened| match opened {
            Ok(stream) => stream,
            Err(error) => futures_util::stream::once(async move { Err(error) }).boxed(),
        })
        .map(|item| item.map_err(|error| error.error_message()))
        .boxed()
    }

    fn reconnect(&mut self) -> BoxFuture<'_, bool> {
        self.client.transport().reconnect()
    }
}

/// Connects the store to its client's event stream on the store's runtime, so the UI thread can
/// call it without a runtime context. Drop the connection to stop.
pub fn connect(data: &Data, options: events::Options) -> (Connection, JoinHandle<()>) {
    let _runtime = data.runtime().enter();
    data.set_online(false);
    let (connection, batches) = events::connect(Events { client: data.client().clone() }, options);
    let task = data.runtime().spawn(run(data.clone(), connection.watch(), batches));
    (connection, task)
}
