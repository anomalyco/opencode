## ADDED Requirements

### Requirement: a message can be sent to a resolvable peer session

An agent SHALL be able to send a short message to another live opencode-skein session by session
id or an unambiguous title prefix. An ambiguous match SHALL be refused, never guessed. The
caller's own session and its descendants SHALL be excluded from resolution.

#### Scenario: an unambiguous target receives the message
- **WHEN** a message is sent to a session id that resolves to exactly one live peer
- **THEN** the message is delivered to that session

#### Scenario: an ambiguous title is refused
- **WHEN** a title prefix matches more than one live peer
- **THEN** the send is refused with an ambiguity error, and no message is delivered

#### Scenario: a caller cannot message itself or its own subagent
- **WHEN** the resolved target is the caller's own session or a descendant of it
- **THEN** the send is refused

### Requirement: delivered messages carry explicit provenance

A message injected into a target session SHALL be distinguishable from a human-authored prompt,
carrying the sending session's id and title as structured provenance, not only a text prefix.

#### Scenario: the receiving agent can tell it's a peer message
- **WHEN** a peer message is injected into a target session
- **THEN** its provenance metadata identifies the sending session, separately from the message text

### Requirement: delivery status is never overclaimed

The tool result SHALL report only "accepted for delivery" — the target existed and was not
mid-turn at send time — and SHALL NOT claim the peer has seen or acted on the message. Delivery
is fire-and-forget (forked, matching `task.ts`'s background-subagent result injection) because
awaiting the full target turn would block the sender on however long the peer's entire reply
takes, which is wrong for a short coordination message. A target that is literally mid-turn
(actively generating) SHALL be refused up front rather than risked joining/racing that turn; a
target that disappears between resolution and delivery SHALL be reported distinctly as
unreachable, not as accepted.

#### Scenario: a same-directory send reports acceptance, not confirmed reading
- **WHEN** a message is sent to an idle or awaiting-permission same-directory peer
- **THEN** the result reports the message accepted for delivery, not that the peer has read or acted on it

#### Scenario: a mid-turn target is refused, not queued silently
- **WHEN** the resolved target's status is `busy` (actively generating)
- **THEN** the send is refused with a clear reason, and nothing is injected into that turn

#### Scenario: a target that disappears is reported distinctly
- **WHEN** the resolved target session no longer exists by the time delivery is attempted
- **THEN** the result reports it as unreachable, not as accepted
