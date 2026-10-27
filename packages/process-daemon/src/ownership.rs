use std::time::{Duration, Instant};

use anyhow::{Result, bail};

const ACQUIRE_TIMEOUT: Duration = Duration::from_secs(5);
const HANDOFF_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Handoff {
    pub ticket: String,
    pub expires_at: u64,
    deadline: Instant,
}

pub(crate) struct Ownership {
    state: State,
    generation: u64,
}

enum State {
    Starting(Instant),
    Owned(Option<Handoff>),
    Waiting(Handoff),
    Stopped,
}

impl Ownership {
    pub fn new(now: Instant) -> Self {
        Self {
            state: State::Starting(now + ACQUIRE_TIMEOUT),
            generation: 0,
        }
    }

    pub fn tick(&mut self, now: Instant) -> bool {
        match &self.state {
            State::Starting(deadline) if now >= *deadline => self.state = State::Stopped,
            State::Waiting(handoff) if now >= handoff.deadline => self.state = State::Stopped,
            State::Owned(Some(handoff)) if now >= handoff.deadline => {
                self.state = State::Owned(None)
            }
            _ => {}
        }
        matches!(self.state, State::Stopped)
    }

    pub fn claim(&mut self, ticket: Option<&str>, now: Instant) -> Result<u64> {
        self.tick(now);
        match &self.state {
            State::Starting(_) if ticket.is_none() => {}
            State::Owned(Some(handoff)) | State::Waiting(handoff)
                if ticket == Some(handoff.ticket.as_str()) => {}
            State::Owned(_) => bail!("daemon already has a live owner"),
            State::Stopped => bail!("daemon ownership deadline expired or daemon is stopping"),
            _ => bail!("invalid handoff ticket"),
        }
        self.generation += 1;
        self.state = State::Owned(None);
        Ok(self.generation)
    }

    pub fn is_owner(&self, generation: u64) -> bool {
        self.generation == generation && matches!(self.state, State::Owned(_))
    }

    pub fn prepare(&mut self, generation: u64, now: Instant, unix_ms: u64) -> Result<Handoff> {
        self.tick(now);
        if self.generation != generation {
            bail!("handoff requires the owner connection");
        }
        let State::Owned(handoff) = &mut self.state else {
            bail!("handoff requires the owner connection");
        };
        Ok(handoff
            .get_or_insert_with(|| Handoff {
                ticket: format!("{:032x}", rand::random::<u128>()),
                expires_at: unix_ms + HANDOFF_TIMEOUT.as_millis() as u64,
                deadline: now + HANDOFF_TIMEOUT,
            })
            .clone())
    }

    pub fn disconnect(&mut self, generation: u64, now: Instant) {
        // A ticket may transfer ownership before the previous connection closes.
        if !self.is_owner(generation) {
            return;
        }
        self.tick(now);
        self.state = match &self.state {
            State::Owned(Some(handoff)) => State::Waiting(handoff.clone()),
            _ => State::Stopped,
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acquisition_is_exclusive_and_bounded() {
        let now = Instant::now();
        let mut owner = Ownership::new(now);
        assert!(owner.claim(Some("unexpected"), now).is_err());
        let generation = owner.claim(None, now).unwrap();
        assert!(owner.claim(None, now).is_err());
        owner.disconnect(generation, now);
        assert!(owner.tick(now));
        assert!(owner.claim(None, now).is_err());

        let mut starting = Ownership::new(now);
        assert!(!starting.tick(now + ACQUIRE_TIMEOUT - Duration::from_millis(1)));
        assert!(starting.claim(None, now + ACQUIRE_TIMEOUT).is_err());
        assert!(starting.tick(now + ACQUIRE_TIMEOUT));
    }

    #[test]
    fn handoff_is_nonrenewing_and_consumed_by_claim() {
        let now = Instant::now();
        let mut owner = Ownership::new(now);
        let generation = owner.claim(None, now).unwrap();
        let handoff = owner.prepare(generation, now, 1000).unwrap();
        assert_eq!(handoff.expires_at, 121_000);
        assert_eq!(
            owner
                .prepare(generation, now + Duration::from_secs(60), 61_000)
                .unwrap(),
            handoff
        );
        owner.disconnect(generation, now);
        assert!(owner.claim(None, now).is_err());
        assert!(owner.claim(Some("wrong"), now).is_err());
        let successor = owner.claim(Some(&handoff.ticket), now).unwrap();
        assert!(owner.claim(Some(&handoff.ticket), now).is_err());
        owner.disconnect(successor, now);
        assert!(owner.tick(now));
    }

    #[test]
    fn valid_ticket_replaces_live_owner_and_fences_old_connection() {
        let now = Instant::now();
        let mut owner = Ownership::new(now);
        let generation = owner.claim(None, now).unwrap();
        let handoff = owner.prepare(generation, now, 1000).unwrap();
        assert!(owner.claim(None, now).is_err());
        assert!(owner.claim(Some("wrong"), now).is_err());
        assert!(owner.is_owner(generation));

        let successor = owner.claim(Some(&handoff.ticket), now).unwrap();
        assert!(!owner.is_owner(generation));
        assert!(owner.is_owner(successor));
        assert!(owner.claim(Some(&handoff.ticket), now).is_err());
        assert!(owner.prepare(generation, now, 1000).is_err());
        owner.disconnect(generation, now);
        assert!(owner.is_owner(successor));
        assert!(!owner.tick(now));

        let next = owner.prepare(successor, now, 1000).unwrap();
        owner.disconnect(generation, now);
        assert!(owner.is_owner(successor));
        owner.disconnect(successor, now);
        // Stale cleanup must not discard the successor's pending handoff either.
        owner.disconnect(generation, now);
        let last = owner.claim(Some(&next.ticket), now).unwrap();
        owner.disconnect(last, now);
        assert!(owner.tick(now));
    }

    #[test]
    fn expiry_only_stops_a_disconnected_owner() {
        let now = Instant::now();
        let mut owner = Ownership::new(now);
        let generation = owner.claim(None, now).unwrap();
        let handoff = owner.prepare(generation, now, 1000).unwrap();
        assert!(!owner.tick(handoff.deadline));
        assert!(matches!(owner.state, State::Owned(None)));
        assert!(
            owner
                .claim(Some(&handoff.ticket), handoff.deadline)
                .is_err()
        );
        assert!(owner.is_owner(generation));
        owner.disconnect(generation, handoff.deadline);
        assert!(owner.tick(handoff.deadline));

        let mut owner = Ownership::new(now);
        let generation = owner.claim(None, now).unwrap();
        let handoff = owner.prepare(generation, now, 1000).unwrap();
        owner.disconnect(generation, now);
        assert!(!owner.tick(handoff.deadline - Duration::from_millis(1)));
        assert!(
            owner
                .claim(Some(&handoff.ticket), handoff.deadline)
                .is_err()
        );
        assert!(owner.tick(handoff.deadline));
    }
}
