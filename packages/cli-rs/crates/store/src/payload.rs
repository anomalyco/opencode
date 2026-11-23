//! The events as the connection hands them to the store. The connection decodes each event, as the stream's reader
//! did, except the streaming deltas, which nothing keeps: a delta that no listener wants, and whose strings have no
//! escape, it only checks, through a view that borrows its strings. The store decodes that view again where it applies
//! it, which allocates nothing.

use std::borrow::Cow;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use opencode_api::de::Raw;
use opencode_api::events::Event;
use opencode_api::generated::*;
use opencode_api::sse;
use serde::Deserialize;

use crate::core::Delta;
use crate::state::State;

/// An event as the store's connection hands it over: decoded, or the JSON of a delta that the connection checked.
#[derive(Debug)]
pub struct Payload(pub(crate) Kind);

// The event unboxed, as the connection's batches held events before: a box would cost an allocation per event.
#[allow(clippy::large_enum_variant)]
#[derive(Debug)]
pub(crate) enum Kind {
    Hot(Hot, String),
    Event(V2Event),
}

impl From<V2Event> for Payload {
    fn from(event: V2Event) -> Self {
        Self(Kind::Event(event))
    }
}

impl Event for Payload {
    fn connected(&self) -> bool {
        matches!(&self.0, Kind::Event(event) if event.connected())
    }

    /// Joins decoded deltas, as [`V2Event`]s join.
    fn merge(&mut self, next: &Self) -> bool {
        match (&mut self.0, &next.0) {
            (Kind::Event(last), Kind::Event(next)) => last.merge(next),
            _ => false,
        }
    }
}

/// Whether a listener of the store wants the deltas as owned events, which its connection then decodes. The store sets
/// it as listeners come and go; one that comes meanwhile gets the deltas decoded where they are applied.
#[derive(Debug, Clone, Default)]
pub struct Wanted(Arc<AtomicBool>);

impl Wanted {
    fn deltas(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }

    /// Sets whether the deltas are wanted.
    pub(crate) fn set(&self, wanted: bool) {
        self.0.store(wanted, Ordering::Relaxed);
    }
}

impl Payload {
    /// Reads one event's payload, its `data:` text, as the stream's reader decodes it, with the same error when it does
    /// not decode. A delta, when `wanted` does not want the deltas and its strings have no escape, is only checked,
    /// through the view that borrows its strings.
    pub fn read(text: String, wanted: &Wanted) -> Result<Self, sse::Error> {
        let hot = Hot::of(&text);
        if let Some(hot) = hot
            && !wanted.deltas()
            && hot.borrows(&text)
        {
            return Ok(Self(Kind::Hot(hot, text)));
        }
        decode(&text, hot).map(Self::from)
    }

    /// The event, decoded in place if it is JSON; `None` for JSON that does not decode, which [`Payload::read`] did
    /// not let through.
    pub(crate) fn event(&mut self) -> Option<&mut V2Event> {
        if let Kind::Hot(hot, text) = &self.0 {
            self.0 = Kind::Event(decode(text, Some(*hot)).ok()?);
        }
        match &mut self.0 {
            Kind::Event(event) => Some(event),
            Kind::Hot(..) => None,
        }
    }

    /// The streaming delta it holds, decoded in place; `None` for any other event.
    pub(crate) fn delta(&mut self) -> Option<&mut V2Event> {
        self.event().filter(|event| Delta::of(event).is_some())
    }
}

/// Decodes the event `text` holds, as the stream's reader does; `hot` says whether it is one of those, and which. That
/// reader checks the whole text, reads its tag, then decodes the member the tag names; this decodes that member at
/// once, and leaves text it cannot decode to that reader, for the same event or the same error.
fn decode(text: &str, hot: Option<Hot>) -> Result<V2Event, sse::Error> {
    let event = match hot {
        Some(Hot::Text) => serde_json::from_str(text).map(V2Event::SessionTextDelta),
        Some(Hot::Reasoning) => serde_json::from_str(text).map(V2Event::SessionReasoningDelta),
        Some(Hot::ToolInput) => serde_json::from_str(text).map(V2Event::SessionToolInputDelta),
        Some(Hot::Compaction) => serde_json::from_str(text).map(V2Event::SessionCompactionDelta),
        None => V2Event::from_raw(&Raw::Text(Cow::Borrowed(text))),
    };
    event.or_else(|_| sse::decode(text))
}

/// The events a view decodes: the streaming deltas, which nothing keeps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Hot {
    Text,
    Reasoning,
    ToolInput,
    Compaction,
}

impl Hot {
    /// The one `text` holds, read from its tag alone; `None` for any other event.
    fn of(text: &str) -> Option<Self> {
        Some(match Raw::Text(Cow::Borrowed(text)).field("type").as_str()? {
            "session.text.delta" => Self::Text,
            "session.reasoning.delta" => Self::Reasoning,
            "session.tool.input.delta" => Self::ToolInput,
            "session.compaction.delta" => Self::Compaction,
            _ => return None,
        })
    }

    /// Whether `text` decodes as its view, which accepts nothing its owned event rejects, with every string borrowed.
    fn borrows(self, text: &str) -> bool {
        match self {
            Self::Text => serde_json::from_str(text).is_ok_and(|view: SessionTextDeltaView| view.borrowed()),
            Self::Reasoning => serde_json::from_str(text).is_ok_and(|view: SessionReasoningDeltaView| view.borrowed()),
            Self::ToolInput => serde_json::from_str(text).is_ok_and(|view: SessionToolInputDeltaView| view.borrowed()),
            Self::Compaction => {
                serde_json::from_str(text).is_ok_and(|view: SessionCompactionDeltaView| view.borrowed())
            }
        }
    }
}

impl State {
    /// Applies `payloads`, adjacent JSON of `hot`, through views that borrow their strings. Adjacent deltas of one part
    /// join in `text` first, as the connection's batches join decoded ones.
    pub(crate) fn apply_borrowed(&mut self, hot: Hot, payloads: &[Payload], text: &mut String) {
        let mut at = 0;
        while at < payloads.len() {
            // Each decodes, as [`Payload::read`] checked; one that did not would be skipped.
            at += self.apply_run(hot, &payloads[at..], text).max(1);
        }
    }

    /// Applies the delta at the start of `payloads` with the deltas right after it that continue its part; how many it
    /// applied.
    fn apply_run(&mut self, hot: Hot, payloads: &[Payload], text: &mut String) -> usize {
        match hot {
            Hot::Text => {
                let mut views = views::<SessionTextDeltaView>(payloads).map(|view| view.data);
                let Some(first) = views.next() else { return 0 };
                let rest = views.take_while(|next| same_text(&first, next));
                let (count, delta) = join(&first.delta, rest, text, |next| &next.delta);
                let (session, message) = (&first.session_id, &first.assistant_message_id);
                self.apply_delta(Delta::Text { session, message, delta });
                count
            }
            Hot::Reasoning => {
                let mut views = views::<SessionReasoningDeltaView>(payloads).map(|view| view.data);
                let Some(first) = views.next() else { return 0 };
                let rest = views.take_while(|next| same_text(&first, next));
                let (count, delta) = join(&first.delta, rest, text, |next| &next.delta);
                let (session, message) = (&first.session_id, &first.assistant_message_id);
                self.apply_delta(Delta::Reasoning { session, message, delta });
                count
            }
            Hot::ToolInput => {
                let mut views = views::<SessionToolInputDeltaView>(payloads).map(|view| view.data);
                let Some(first) = views.next() else { return 0 };
                let rest = views.take_while(|next| {
                    (&next.session_id, &next.assistant_message_id, &next.id)
                        == (&first.session_id, &first.assistant_message_id, &first.id)
                });
                let (count, delta) = join(&first.delta, rest, text, |next| &next.delta);
                let (session, message) = (&first.session_id, &first.assistant_message_id);
                self.apply_delta(Delta::ToolInput { session, message, tool: &first.id, delta });
                count
            }
            Hot::Compaction => {
                let Some(SessionCompactionDeltaView { data, .. }) = views(payloads).next() else { return 0 };
                self.apply_delta(Delta::Compaction { session: &data.session_id, text: &data.text });
                1
            }
        }
    }
}

/// The views of the JSON payloads at the start of `payloads`, up to the first that does not decode.
fn views<'a, V: Deserialize<'a>>(payloads: &'a [Payload]) -> impl Iterator<Item = V> {
    payloads.iter().map_while(|payload| match &payload.0 {
        Kind::Hot(_, json) => serde_json::from_str(json).ok(),
        Kind::Event(_) => None,
    })
}

/// Whether two text or reasoning deltas continue one part.
fn same_text(first: &SessionTextDeltaDataView, next: &SessionTextDeltaDataView) -> bool {
    (&next.session_id, &next.assistant_message_id, next.ordinal)
        == (&first.session_id, &first.assistant_message_id, first.ordinal)
}

/// The delta `first` with the deltas of `rest` joined to it, in `text` when there are any, and how many deltas it is.
fn join<'t, V>(
    first: &'t str,
    rest: impl Iterator<Item = V>,
    text: &'t mut String,
    delta: impl Fn(&V) -> &str,
) -> (usize, &'t str) {
    text.clear();
    let mut count = 1;
    for next in rest {
        if count == 1 {
            text.push_str(first);
        }
        text.push_str(delta(&next));
        count += 1;
    }
    (count, if count == 1 { first } else { text })
}
