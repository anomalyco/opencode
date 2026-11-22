//! Sends a connection's event batches, with its status, to the store's owner.

use std::collections::VecDeque;

use futures_util::StreamExt;
use futures_util::stream::BoxStream;
use opencode_api::client::Client;
use opencode_api::events::{self, Activity, Connection, Event, Source, Status};
use opencode_api::generated::*;
use opencode_api::transport::BoxFuture;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use crate::driver::{Data, Mail, Remote};

/// The most events [`run`] holds while the store's mailbox is full. Past that it stops reading the connection, whose
/// own queue then fills, and the connection drops the stream.
pub const HELD: usize = 65_536;

/// Drives the store from a connection: sends its batches to the store's owner, each with whether it is connected.
/// Returns when the batch receiver closes or the store is gone. While the owner does not drain (the UI thread runs a
/// foreground program), the store's mailbox fills; this then keeps reading, and holds the batches with adjacent deltas
/// merged, so the stream stays up and no event is lost.
pub async fn run(remote: Remote, mut state: watch::Receiver<events::State>, mut batches: mpsc::Receiver<Vec<V2Event>>) {
    let mut watching = true;
    let mut held = Held::default();
    loop {
        if !held.send(&remote) {
            return;
        }
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
                        held.push(Mail::Batch(batch, None));
                    }
                }
                held.push(Mail::Online(online));
            }
            room = remote.room(), if !held.mail.is_empty() => {
                if !room {
                    return;
                }
            }
            batch = batches.recv(), if held.events < HELD => {
                let Some(batch) = batch else {
                    for mail in held.mail {
                        if !remote.send(mail).await {
                            return;
                        }
                    }
                    return;
                };
                let online = state.borrow().status == Status::Connected;
                held.push(Mail::Batch(batch, Some(online)));
            }
        }
    }
}

/// The mail [`run`] has not sent yet, in order, and how many events it holds.
#[derive(Default)]
struct Held {
    mail: VecDeque<Mail>,
    events: usize,
}

impl Held {
    /// Holds `mail`. A batch joins a held batch before it when the connection status between them is the same, and its
    /// first delta merges into that batch's last, as the connection merges adjacent deltas within a batch.
    fn push(&mut self, mail: Mail) {
        let tail = match (self.mail.back_mut(), mail) {
            (Some(Mail::Batch(tail, before)), Mail::Batch(batch, online)) if online.is_none() || online == *before => {
                (tail, batch)
            }
            (_, mail) => {
                self.events += mail.events();
                self.mail.push_back(mail);
                return;
            }
        };
        let (tail, batch) = tail;
        for event in batch {
            if tail.last_mut().is_some_and(|last| last.merge(&event)) {
                continue;
            }
            tail.push(event);
            self.events += 1;
        }
    }

    /// Sends what fits in the mailbox now; false once the store is gone.
    fn send(&mut self, remote: &Remote) -> bool {
        while let Some(mail) = self.mail.pop_front() {
            let events = mail.events();
            match remote.try_send(mail) {
                Ok(()) => self.events -= events,
                Err(Some(mail)) => {
                    self.mail.push_front(mail);
                    return true;
                }
                Err(None) => return false,
            }
        }
        true
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
