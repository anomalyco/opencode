## ADDED Requirements

### Requirement: an agent SHALL be able to ask which other sessions are working here

A `peers` tool SHALL report the sessions active in the same directory as the calling
session.

Each entry SHALL carry the session id, its title, its status, the agent and model driving
it when known, the loop id and iteration when a loop is driving it, and how long since that
session last produced an event.

#### Scenario: a concurrent session is reported

- **WHEN** `peers` is called and another session in the same directory is busy
- **THEN** that session is returned with its id, title, and a busy status

#### Scenario: nothing to report

- **WHEN** `peers` is called and no other session in the directory is active
- **THEN** an empty roster is returned and the result says so plainly

### Requirement: a session SHALL NOT be reported as its own peer, nor SHALL its own subagents

The calling session MUST be excluded from its own roster, and so MUST every session
descended from it.

A run that fans out to a reviewer or a coder would otherwise see its own subagents as
competing agents, and every delegation would read as a collision — which would make the
signal useless exactly when the run is doing the right thing.

#### Scenario: the caller is not its own peer

- **WHEN** `peers` is called from a busy session
- **THEN** that session does not appear in the result

#### Scenario: a subagent is not a peer of its parent

- **WHEN** a session has spawned a subagent that is currently working
- **AND** `peers` is called from the parent
- **THEN** the subagent does not appear in the result

#### Scenario: a sibling's subagent is still a peer

- **WHEN** another top-level session in the directory has a working subagent
- **AND** `peers` is called
- **THEN** that other lineage is reported, because it is not the caller's own work

### Requirement: only sessions that are actually working count as peers

A session SHALL be reported as a peer only when it is busy, awaiting permission, stalled,
or being driven by a live loop.

An idle session MUST NOT be reported. A directory accumulates abandoned sessions, and a
warning that fires on every one of them is a warning nobody reads.

#### Scenario: an idle session is not a peer

- **WHEN** another session in the directory exists but is idle with no live loop
- **THEN** it is not reported

#### Scenario: a session blocked on permission is a peer

- **WHEN** another session in the directory is waiting on a permission prompt
- **THEN** it is reported, with a status distinguishing it from busy

#### Scenario: a session in another directory is not a peer

- **WHEN** a session is active in a different directory
- **THEN** it is not reported

### Requirement: peers SHALL expose metadata only, never transcript content

The roster SHALL contain no message text, prompt, tool call, or tool output from another
session.

Titles are permitted and required: they are session metadata, and they are the only field
by which two sessions doing the same work can be told apart.

#### Scenario: no content leaks through the roster

- **WHEN** another session has exchanged messages and run tools
- **THEN** none of that text appears anywhere in the peers result

### Requirement: a queue run SHALL tell the model about active neighbours

A queue iteration's brief SHALL name the other sessions active in the directory when there
are any, and SHALL instruct the model to avoid work another session is likely doing.

When a queue iteration is built and other sessions are active in the directory, the brief
names them and instruct the model to avoid work another session is likely doing.

The brief SHALL omit this entirely when there are no active peers.

This is awareness, not enforcement: a queue run SHALL NOT be prevented from starting or
continuing because another session is active.

#### Scenario: the brief warns about a neighbour

- **WHEN** a queue iteration's brief is built and another session in the directory is busy
- **THEN** the brief names that session and warns against overlapping work

#### Scenario: a quiet repo produces no warning

- **WHEN** a queue iteration's brief is built and no other session is active
- **THEN** the brief contains no peer warning

#### Scenario: a neighbour does not block the run

- **WHEN** a queue run starts while another session is active in the directory
- **THEN** the run proceeds
