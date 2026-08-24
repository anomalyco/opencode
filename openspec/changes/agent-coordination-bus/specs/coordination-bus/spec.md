## ADDED Requirements

### Requirement: the bus is never authoritative
The broker SHALL act as a cache and notification channel only. The owning instance remains
authoritative for its presence, and the lease store remains authoritative for leases. A
broker outage SHALL degrade the mesh to polling rather than breaking coordination.

#### Scenario: broker outage degrades rather than fails
- **WHEN** the broker becomes unreachable
- **THEN** instances continue to discover peers, read capacity, and acquire leases via the polling paths, and no placement or session is blocked

#### Scenario: bus state never overrides the owner
- **WHEN** a retained presence message disagrees with what the owning instance reports directly
- **THEN** the owning instance's answer is used

### Requirement: only structured, typed messages are carried
Every message SHALL declare a type from a closed set: presence, lease, decision-request,
decision-answer, artifact-result. Messages of unrecognised type SHALL be dropped. The bus
SHALL NOT carry free-form agent-authored prose.

#### Scenario: an unrecognised type is dropped
- **WHEN** a message arrives whose type is not in the closed set
- **THEN** it is discarded and not delivered to any consumer

#### Scenario: agents cannot broadcast reasoning
- **WHEN** an agent attempts to publish narrative or speculative content
- **THEN** there is no message type that accepts it

### Requirement: claims are never established over the bus
Lease acquisition SHALL NOT be performed by publishing to the bus. The bus MAY announce a
lease already acquired from an authoritative store.

#### Scenario: a published claim confers nothing
- **WHEN** two instances publish a lease announcement for the same slot simultaneously
- **THEN** neither is thereby entitled to the slot; entitlement comes only from the lease store

### Requirement: node death is an event, not an inference
Each instance SHALL register a Last Will marking its sessions unreachable. On ungraceful
disconnect the broker SHALL publish it without the instance acting.

#### Scenario: a killed instance is reported immediately
- **WHEN** an instance is killed without a clean shutdown
- **THEN** subscribers observe its sessions become unreachable without waiting for a polling timeout

#### Scenario: clean shutdown withdraws rather than dies
- **WHEN** an instance shuts down cleanly
- **THEN** its retained records are withdrawn and no unreachable state is published

### Requirement: a human answer fans out to every agent waiting on it
A blocked agent SHALL be able to publish a decision request naming its session and exact
question. A human client SHALL be able to answer once, and every agent blocked on that
same question SHALL receive it. An agent SHALL act only on an answer to a question it
itself asked, and an unanswered request SHALL continue blocking rather than defaulting.

#### Scenario: one answer unblocks several agents
- **WHEN** three sessions are blocked on the same decision and the human answers once
- **THEN** all three receive the answer and proceed, without the human visiting three terminals

#### Scenario: an answer is attributable
- **WHEN** a decision is answered
- **THEN** the answer records which human client produced it

#### Scenario: an agent ignores answers to questions it did not ask
- **WHEN** an answer arrives for a different session's decision request
- **THEN** the agent does not act on it

#### Scenario: no answer means no progress
- **WHEN** a decision request goes unanswered
- **THEN** the requesting agent stays blocked and no default is applied

### Requirement: topics are namespaced and the client stays inside them
All traffic SHALL live under a dedicated topic prefix, and the client SHALL subscribe to
nothing outside it. The broker is shared with unrelated home-automation traffic.

#### Scenario: unrelated broker traffic is never consumed
- **WHEN** home-automation messages are published on the same broker
- **THEN** the client neither receives nor processes them

### Requirement: identifying metadata requires a protected channel
Presence records containing directory paths or session titles SHALL NOT be published over
an unauthenticated, unencrypted connection. On such a connection the bus SHALL either
publish a reduced record carrying no identifying metadata, or refuse to publish.

#### Scenario: plain-text broker gets reduced records
- **WHEN** the broker connection is neither encrypted nor authenticated
- **THEN** published presence omits directory paths and session titles

#### Scenario: protected connection carries full records
- **WHEN** the connection is encrypted and authenticated
- **THEN** full presence records may be published
