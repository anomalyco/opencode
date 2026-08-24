# Session Summary Write Amplification

## ADDED Requirements

### Requirement: Concurrent summary runs do not stack
`SessionSummary.summarize` SHALL NOT allow more than one in-flight full run per
session. A call for a session that already has a run in progress SHALL be
skipped without error.

#### Scenario: Fast-moving turn
- **WHEN** a turn's steps complete faster than the previous step's diff
  computation
- **THEN** the later step's summarize call is skipped, and the diff shown
  reflects whichever call actually completes

### Requirement: Steady-state full runs are time-bounded
`SessionSummary.summarize` SHALL NOT perform more than one full diff computation
and persist (including patch text) per session within a 5 second window, unless
called with `force: true`. A throttled call SHALL be a no-op and SHALL NOT reset
the currently displayed diff summary to empty.

#### Scenario: Many steps in quick succession
- **WHEN** a turn executes several tool-only steps within a 5 second window
- **THEN** at most one full diff persist occurs for that window, and the
  displayed summary is not zeroed by the skipped calls

#### Scenario: Forced call bypasses the throttle
- **WHEN** `summarize` is called with `force: true`
- **THEN** the full diff computation and persist run regardless of how recently
  the previous full run completed, subject only to the concurrency guard

### Requirement: Turn completion always persists an accurate summary
When an agent turn completes normally (no further tool calls pending), the
session's diff summary for that turn's triggering user message SHALL be
recomputed and persisted with `force: true`, so a throttled intermediate step
never leaves the final state stale.

#### Scenario: Last steps were throttled
- **WHEN** a turn's final steps landed within the throttle window of a prior
  full run
- **THEN** the turn-completion exit still produces an accurate, fully persisted
  diff for the whole turn

### Requirement: A lock conflict on the shared session database is bounded and surfaced
The session database connection SHALL set a non-zero busy timeout, so a lock
conflict waits a bounded amount of time and then fails with a catchable error
rather than blocking indefinitely with no signal to the caller.

#### Scenario: Concurrent writers contend for the same database file
- **WHEN** two opencode processes attempt a write to the shared session database
  at the same time
- **THEN** the losing writer waits up to the configured busy timeout and then
  either succeeds or fails with an error, never hangs indefinitely
