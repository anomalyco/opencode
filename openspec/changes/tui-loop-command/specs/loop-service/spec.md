## ADDED Requirements

### Requirement: server-side loop lifecycle
The server SHALL own loop state and expose create, list, get, pause, resume, and cancel operations via the SDK/HTTP API. A loop created from any client SHALL be visible and controllable from every other client connected to the same server.

#### Scenario: loop started in CLI is controllable from TUI
- **WHEN** a loop is started with `opencode loop "<prompt>"` and the TUI opens the loops dialog
- **THEN** the loop appears with its iteration count and can be paused from the TUI

### Requirement: bounded iterations with completion signal
A loop SHALL stop when an iteration's output contains `<promise>COMPLETE</promise>`, when the configured maximum iteration count is reached, or when it is cancelled — whichever comes first. There SHALL be no unbounded default.

#### Scenario: max iterations caps a runaway loop
- **WHEN** a loop runs `--max 5` iterations without a COMPLETE signal
- **THEN** the loop ends with status `max_reached` after the 5th iteration

### Requirement: no-progress detection
The service SHALL track per-iteration progress signals (tool-call count, output). After a configurable number of consecutive iterations (default 3) with no tool calls and near-identical output, the loop SHALL stop with status `stalled` and emit a notification event. The guard SHALL be configurable per loop and disableable.

#### Scenario: token-less looping is stopped
- **WHEN** three consecutive iterations produce no tool calls and near-identical text without a COMPLETE token
- **THEN** the loop stops with status `stalled` instead of continuing to burn iterations

### Requirement: loop sessions are grouped under a parent
Each loop SHALL create one parent session, and each iteration SHALL run in a child session of that parent, so iteration transcripts are navigable from the session hierarchy.

#### Scenario: iterations are not orphan sessions
- **WHEN** a loop has run 4 iterations
- **THEN** the session list shows one loop parent with 4 child sessions rather than 4 unrelated sessions

### Requirement: loop state change events
The service SHALL emit an event on every loop state change (created, iteration started/finished, paused, resumed, completed, stalled, cancelled) on the existing event bus.

#### Scenario: clients update without polling
- **WHEN** an iteration finishes
- **THEN** subscribed clients receive a loop.updated event carrying the new iteration count and status
