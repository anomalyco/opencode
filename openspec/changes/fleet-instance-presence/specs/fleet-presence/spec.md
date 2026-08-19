## ADDED Requirements

### Requirement: instances are discoverable

Each opencode server SHALL advertise itself on the local network with instance id, host,
pid, API base URL, version, and open session directories. Discovery SHALL require no
manual configuration on the same subnet, and advertisement SHALL be disableable.

#### Scenario: a peer is found without configuration

- **WHEN** two opencode instances run on the same subnet with advertisement enabled
- **THEN** each lists the other with its API base URL and open directories

#### Scenario: advertisement can be turned off

- **WHEN** advertisement is disabled
- **THEN** the instance is not discoverable and continues to function normally

### Requirement: instances publish per-session status

An instance SHALL publish, for each active session, its id, directory, agent, model,
status, loop iteration count where applicable, and the time since the last token or tool
event. Status SHALL distinguish at minimum `idle`, `busy`, `awaiting-permission`,
`cancelling`, and `stalled`.

#### Scenario: a session waiting on a human is visible as such

- **WHEN** a session is blocked on a permission prompt
- **THEN** its presence record reports `awaiting-permission`, distinct from `busy`

#### Scenario: loop progress is visible

- **WHEN** a session is driven by a loop on iteration 7
- **THEN** its presence record reports the loop and the iteration count

### Requirement: wedged sessions announce themselves

An instance SHALL report a session as `stalled` when it has a turn in flight and no token,
tool event, or state change for longer than a configured threshold, and SHALL continue
publishing that record. A wedged session SHALL NOT simply stop reporting.

#### Scenario: the 18-hour hang is surfaced in minutes

- **WHEN** a session's provider stream goes silent while the turn stays in flight
- **THEN** the session is reported `stalled` with the elapsed silence once the threshold passes, and remains listed

#### Scenario: a healthy provider does not mask a wedged client

- **WHEN** the provider reports zero in-flight requests while the client still believes a turn is running
- **THEN** the session is reported `stalled` regardless of provider health

### Requirement: presence carries a heartbeat

Presence records SHALL carry a heartbeat. A record whose heartbeat lapses SHALL be
reported `unreachable` rather than removed, so a crashed instance is distinguishable from
one that shut down cleanly.

#### Scenario: a killed instance is visibly gone, not silently gone

- **WHEN** an instance is killed without shutting down
- **THEN** its sessions are reported `unreachable` with the time of last heartbeat

#### Scenario: a clean exit is not reported as a crash

- **WHEN** an instance shuts down cleanly
- **THEN** its records are withdrawn rather than left as `unreachable`

### Requirement: one Agents view, with control

A command SHALL list every discovered instance and session with status and age, and SHALL
support cancelling or pausing a session on another instance via that instance's API.

#### Scenario: the human answers "what is running" in one place

- **WHEN** four instances are running across three directories
- **THEN** one command lists all of them with per-session status and age

#### Scenario: a wedged session is recoverable without a terminal

- **WHEN** the human selects a `stalled` session on another instance and cancels it
- **THEN** that instance cancels the session and the status updates, without the human locating its terminal

### Requirement: presence exposure is opt-out and scoped

Presence SHALL expose no session content — only metadata. Directory paths and titles are
metadata and SHALL be suppressible.

#### Scenario: no prompt or output content leaves the instance

- **WHEN** a peer reads a presence record
- **THEN** it receives status metadata only, with no prompt text, tool output, or message content
