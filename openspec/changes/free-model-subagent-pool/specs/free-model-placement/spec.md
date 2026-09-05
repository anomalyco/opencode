## ADDED Requirements

### Requirement: free-tier cloud candidates require a passed liveness handshake

A free-tier cloud model SHALL NOT be placement-eligible without a currently-passed liveness
handshake (a deterministic prompt requiring an exact-match response within a bounded timeout).
Selection SHALL NOT fall back to an unverified or stale-probe candidate.

#### Scenario: an unverified candidate is never selected
- **WHEN** a free-tier candidate has no passed handshake within its TTL window
- **THEN** it is not offered as a placement target, even when no other candidate is eligible

#### Scenario: a passed handshake makes a candidate eligible
- **WHEN** a free-tier candidate responds with an exact match to the liveness prompt within the timeout
- **THEN** it becomes placement-eligible until its TTL expires

### Requirement: free-tier candidates are lowest priority

Placement SHALL prefer local llama-skein hosts and live opencode peers over a free-tier cloud
candidate; a free-tier candidate SHALL only be offered when no local or peer candidate is
eligible.

#### Scenario: a local candidate wins over a free-tier candidate
- **WHEN** an eligible local host and an eligible free-tier candidate are both available
- **THEN** the local host is selected

### Requirement: handshake probing is cached, not per-placement

Liveness handshakes SHALL be cached with a short TTL and re-probed only on expiry, not on every
placement decision.

#### Scenario: a cached pass is reused
- **WHEN** a placement decision is made while a candidate's handshake is still within its TTL
- **THEN** no new handshake request is sent for that decision
