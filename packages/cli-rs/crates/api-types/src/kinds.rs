//! Sets of event types, matched by [`EventKind`] rather than by name.

use crate::types::{EventKind, V2Event};

const _: () = assert!(EventKind::COUNT <= 128, "a kind is a bit of a u128");

/// A set of [`V2Event`] types: a bit per kind, and the names asked for of the kinds whose events differ in their
/// `type` ([`EventKind::named`]: the `rpc.*` members and the types this client does not know).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EventKinds {
    bits: u128,
    names: Vec<String>,
}

impl EventKinds {
    /// The types `tags` name as on the wire (`session.deleted`).
    pub fn named<S: AsRef<str>>(tags: impl IntoIterator<Item = S>) -> Self {
        let mut kinds = Self::default();
        for tag in tags {
            let kind = EventKind::from_tag(tag.as_ref());
            kinds.bits |= 1 << kind as u8;
            if kind.named() {
                kinds.names.push(tag.as_ref().to_owned());
            }
        }
        kinds
    }

    /// Whether `event` is of a type in the set.
    pub fn contains(&self, event: &V2Event) -> bool {
        let kind = event.kind();
        self.bits >> kind as u8 & 1 == 1 && (!kind.named() || self.names.iter().any(|name| name == event.tag()))
    }

    /// The indices of the kinds in the set, as `kind as usize`.
    pub fn indices(&self) -> impl Iterator<Item = usize> + '_ {
        (0..EventKind::COUNT).filter(|index| self.bits >> index & 1 == 1)
    }

    /// The names asked for of the [`EventKind::named`] kinds.
    pub fn names(&self) -> &[String] {
        &self.names
    }
}

impl<const N: usize> From<[EventKind; N]> for EventKinds {
    fn from(kinds: [EventKind; N]) -> Self {
        Self { bits: kinds.iter().fold(0, |bits, kind| bits | 1 << *kind as u8), names: Vec::new() }
    }
}
