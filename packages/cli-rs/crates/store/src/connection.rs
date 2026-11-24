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
use crate::payload::{Payload, Wanted};

/// The most events [`run`] holds while the store's mailbox is full. Past that it stops reading the connection, whose
/// own queue then fills, and the connection drops the stream. The batches queued then are dropped, not held: the
/// offline transition after them invalidates every read, and the next stream's `server.connected` reads it all again.
pub const HELD: usize = 65_536;

/// Drives the store from a connection: sends its batches to the store's owner, each with whether it is connected.
/// Returns when the batch receiver closes or the store is gone. While the owner does not drain (the UI thread runs a
/// foreground program), the store's mailbox fills; this then keeps reading, and holds the batches with each part's
/// deltas merged, so the stream stays up and no event is lost, up to [`HELD`] events.
pub async fn run(remote: Remote, mut state: watch::Receiver<events::State>, mut batches: mpsc::Receiver<Vec<Payload>>) {
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
                        if held.events < HELD {
                            held.push(Mail::Batch(batch, None));
                        }
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
    /// Holds `mail`. A batch joins a held batch before it when the connection status between them is the same, and
    /// each of its deltas merges into its part's delta in the run of deltas the held batch ends with: appends to
    /// different parts commute, and an event between them keeps its place. A delta that came as JSON is decoded here
    /// only when it merges. A status the hold ends with already adds
    /// nothing, and down, up and down again is down once, so a connection that keeps dropping adds nothing either.
    fn push(&mut self, mail: Mail) {
        if matches!(mail, Mail::Online(false)) && self.ends_down_up() {
            self.mail.pop_back();
            return;
        }
        let (tail, batch) = match (self.mail.back_mut(), mail) {
            (Some(Mail::Batch(tail, before)), Mail::Batch(batch, online)) if online.is_none() || online == *before => {
                (tail, batch)
            }
            (Some(Mail::Online(last)), Mail::Online(online)) if *last == online => return,
            (_, mail) => {
                self.events += mail.events();
                self.mail.push_back(mail);
                return;
            }
        };
        for mut payload in batch {
            // Text deltas match by ordinal, as the connection's own merge does: a message has one open text part.
            let merged = match payload.delta() {
                Some(event) => tail.iter_mut().rev().map_while(Payload::delta).any(|last| last.merge(event)),
                None => false,
            };
            if !merged {
                tail.push(payload);
                self.events += 1;
            }
        }
    }

    /// The hold ends with the connection going down, then up.
    fn ends_down_up(&self) -> bool {
        let mut tail = self.mail.iter().rev();
        matches!((tail.next(), tail.next()), (Some(Mail::Online(true)), Some(Mail::Online(false))))
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
    /// What the store's listeners want decoded here.
    pub wanted: Wanted,
}

impl Source<Payload> for Events {
    /// The error as TS's connection records it: a declared error's message, else the client error's text.
    type Error = String;

    /// The stream's events, each read by [`Payload::read`] as the stream frames it: the stream ends at the first that
    /// does not decode, with its error.
    fn open(&mut self, activity: Activity) -> BoxStream<'static, Result<Payload, Self::Error>> {
        let (client, wanted) = (self.client.clone(), self.wanted.clone());
        futures_util::stream::once(async move {
            client
                .event_subscribe(&EventSubscribeInput::default())
                .await
                .map(|response| response.read(move || activity(), move |text| Payload::read(text, &wanted)).boxed())
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
    let events = Events { client: data.client().clone(), wanted: data.remote().wanted() };
    let (connection, batches) = events::connect(events, options);
    let task = data.runtime().spawn(run(data.remote(), connection.watch(), batches));
    (connection, task)
}
