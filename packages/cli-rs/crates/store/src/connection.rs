//! Sends a connection's event batches, with its status, to the store's owner.

use futures_util::StreamExt;
use futures_util::stream::BoxStream;
use opencode_api::client::Client;
use opencode_api::events::{self, Activity, Connection, Source, Status};
use opencode_api::generated::*;
use opencode_api::transport::BoxFuture;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use crate::driver::{Data, Mail, Remote};

/// Drives the store from a connection: sends its batches to the store's owner, each with whether it is connected.
/// Returns when the batch receiver closes or the store is gone. While the owner does not drain, the store's mailbox
/// fills and this waits, so the connection's own queue fills behind it.
pub async fn run(remote: Remote, mut state: watch::Receiver<events::State>, mut batches: mpsc::Receiver<Vec<V2Event>>) {
    let mut watching = true;
    loop {
        let sent = tokio::select! {
            biased;
            changed = state.changed(), if watching => {
                if changed.is_err() {
                    watching = false;
                    continue;
                }
                let online = state.borrow_and_update().status == Status::Connected;
                // Apply the final queued batch while still online so disconnect invalidation covers it.
                let mut sent = true;
                if !online {
                    while let Ok(batch) = batches.try_recv() {
                        sent = sent && remote.send(Mail::Batch(batch, None)).await;
                    }
                }
                sent && remote.send(Mail::Online(online)).await
            }
            batch = batches.recv() => {
                let Some(batch) = batch else { return };
                let online = state.borrow().status == Status::Connected;
                remote.send(Mail::Batch(batch, Some(online))).await
            }
        };
        if !sent {
            return;
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
    let task = data.runtime().spawn(run(data.remote(), connection.watch(), batches));
    (connection, task)
}
