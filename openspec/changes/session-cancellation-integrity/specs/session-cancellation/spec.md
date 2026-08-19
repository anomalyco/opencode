## ADDED Requirements

### Requirement: cancellation state is not claimed before it happens
The runner SHALL NOT report a session as idle until interruption of the running fiber
has actually resolved. While cancellation is in flight the session SHALL report busy.

#### Scenario: spinner stays honest during cancellation
- **WHEN** a cancel is issued against a session whose turn is blocked on an unresponsive provider stream
- **THEN** the session reports busy (not idle) until the turn is released, and the UI shows a cancelling state rather than an idle session with a spinning indicator

### Requirement: a second cancel escalates
A cancel issued while a previous cancel is still in flight SHALL escalate — skipping any
remaining grace period and force-releasing the turn. It SHALL NOT be silently discarded.

#### Scenario: repeated Esc is not a no-op
- **WHEN** the user presses Esc, the turn does not stop, and the user presses Esc again
- **THEN** the second press force-releases the session and the user regains control

#### Scenario: cancel is never a silent no-op on a busy session
- **WHEN** 30 cancel requests arrive within 30 milliseconds for a session with a running turn
- **THEN** the session reaches a released state, and no cancel is recorded as a no-op while the turn is still alive

### Requirement: interruption is bounded
Interruption of a running turn SHALL be bounded by a timeout. On expiry the runner SHALL
force the session to idle, fire the idle transition, log the orphaned fiber at WARN with
the session id, and surface a notice distinguishing an abandoned turn from a clean stop.

#### Scenario: unresponsive fiber does not hang the session forever
- **WHEN** a turn's fiber cannot be interrupted within the timeout
- **THEN** the session returns to idle, the user can submit a new prompt, and a WARN entry records the orphaned fiber

### Requirement: stalled provider streams are detected
A provider stream SHALL be torn down when it delivers no bytes and no events for longer
than a configured inactivity deadline, failing the turn with a distinguishable stalled
error rather than blocking indefinitely.

#### Scenario: half-open socket ends the turn
- **WHEN** the provider has finished server-side (`in_flight: 0`) but the client socket stays open with no further data
- **THEN** the turn fails with a stalled-stream error within the inactivity deadline, and the session returns to idle without user intervention

#### Scenario: a slow but live stream is not killed
- **WHEN** a stream delivers tokens slowly but continuously, with gaps shorter than the deadline
- **THEN** the turn is not interrupted
