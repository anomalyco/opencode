## ADDED Requirements

### Requirement: planned work comes from the tracker, not from a second scheduler

`/auto` SHALL take its work, and its order, from the work source, and SHALL NOT re-order,
re-prioritise or filter that list by rules of its own. The system SHALL NOT introduce
configuration that decides which repository or change is worked next.

#### Scenario: the tracker's order is honoured

- **WHEN** the work source reports three claimable items in a given order
- **THEN** they are attempted in that order

#### Scenario: blocked work is never attempted

- **WHEN** an item is blocked by an open dependency, including one in another repository
- **THEN** the work source does not report it and it is not attempted

#### Scenario: priority changes on the board take effect without configuration

- **WHEN** an item's priority or stage changes on the board between runs
- **THEN** the next run reflects it, with no local configuration change

### Requirement: cross-repository aggregation belongs to specsync

The work source SHALL be specsync, which already owns openspec ↔ provider translation in
both directions and already resolves each change's binding. opencode SHALL NOT query a
tracker provider directly, so that provider knowledge stays in one codebase.

#### Scenario: one question, one answer

- **WHEN** planned work spans several repositories
- **THEN** it is obtained by asking specsync once, not by opencode contacting GitHub Projects or beads itself

#### Scenario: a provider change does not reach opencode

- **WHEN** a board's stage or status options change
- **THEN** only specsync needs updating

### Requirement: a planned item resolves to a repository and a change

Each reported item SHALL resolve to a repository path and an openspec change before work
starts, and any item that cannot be resolved to a repository present on this machine SHALL
be skipped with a recorded reason.

#### Scenario: an item becomes a run for its change

- **WHEN** an item names a repository and change present locally
- **THEN** a run is started for that repository, scoped to that change

#### Scenario: an unresolvable item is skipped, not guessed

- **WHEN** an item names a repository that is not on this machine
- **THEN** it is skipped, the report records why, and the run continues

### Requirement: work is claimed in the tracker

An item SHALL be marked in progress in the tracker before work starts and released or
completed afterwards, so a second runner or a person does not take the same work. Claims
SHALL NOT be recorded anywhere else.

#### Scenario: a claimed item is not taken twice

- **WHEN** one runner has claimed an item
- **THEN** a second runner asking for planned work is not offered it

#### Scenario: finishing releases the claim

- **WHEN** a run completes, halts or is cancelled
- **THEN** the item's tracker state reflects that rather than remaining in progress indefinitely

### Requirement: repositories without a tracker binding fall back to disk

A repository with no tracker binding SHALL have its openspec changes worked directly,
using the selection `/auto` already applies within one repository. This fallback SHALL NOT
require configuration to enable.

#### Scenario: an unsynced repo is still worked

- **WHEN** a repository has eligible openspec changes and no tracker binding
- **THEN** its changes are worked as a single-repository run would work them

#### Scenario: a synced repo does not double up

- **WHEN** a repository's changes are reported by the work source
- **THEN** the disk fallback does not also select changes for that repository

### Requirement: done means no planned task remains

A run SHALL end when the work source reports nothing claimable and no repository in scope
has an eligible change left. Ending SHALL be distinguishable in the report from stopping
because nothing was ever found.

#### Scenario: draining ends the run

- **WHEN** every planned task across the reported items is complete or quarantined
- **THEN** the run ends and reports that the planned work is drained

#### Scenario: finding nothing is not the same as finishing

- **WHEN** no work source is reachable and no repository in scope has openspec changes
- **THEN** the run reports that nothing was found rather than that the work is done

### Requirement: gate configuration resolves per repository

Gate options SHALL resolve from the repository's own configuration first, then the
built-in defaults, and one repository's test, verify, working-directory or default-branch
settings SHALL NOT be applied to another.

#### Scenario: each repo uses its own gate commands

- **WHEN** two repositories declare different `experimental.queue_gate.test_command` values
- **THEN** each repository's run executes its own test command

#### Scenario: a repo without gate config still runs

- **WHEN** a repository declares no gate configuration
- **THEN** its run uses the built-in defaults rather than another repository's settings

### Requirement: concurrency is bounded by measured capacity

At most as many repositories SHALL run concurrently as there are local providers with free
capacity, never fewer than one, re-evaluated as each item starts, and at most one run per
repository at a time.

#### Scenario: concurrency follows the fleet

- **WHEN** two local providers report free capacity
- **THEN** at most two repositories are worked at the same time

#### Scenario: no measurable capacity still makes progress

- **WHEN** no local provider reports free capacity
- **THEN** work proceeds one item at a time rather than stalling

#### Scenario: one working tree, one run

- **WHEN** two planned items belong to the same repository
- **THEN** they are not run concurrently

### Requirement: a halted item does not stop the run

An item that halts SHALL be recorded, its claim released, and the run SHALL continue. The
run SHALL stop early only when several consecutive items halt without any gate passing
anywhere, and SHALL then report a suspected environmental cause.

#### Scenario: one bad item does not end the run

- **WHEN** the second of five items halts
- **THEN** its cause is recorded and the run continues with the third

#### Scenario: a broken environment stops the run

- **WHEN** three consecutive items halt without any gate passing anywhere in the run
- **THEN** the run stops and reports a suspected environmental cause

### Requirement: the authority ceiling is inherited unchanged

A run SHALL NOT widen the per-repository authority ceiling. Every item's work SHALL run
under the same deny profile and credential-less shell a single-repository run uses, and
SHALL NOT push, tag, publish, release or deploy.

#### Scenario: nothing is pushed

- **WHEN** a run completes work across several repositories
- **THEN** each has local commits on non-default branches and no push has occurred

### Requirement: one report covers the whole run

A run SHALL produce a single report covering, per item: the repository and change, the
outcome, the cause when it halted, branches awaiting review, and items skipped with the
reason they could not be resolved.

#### Scenario: the report is readable in one place

- **WHEN** a run touched items across twelve repositories
- **THEN** its report states each outcome without the reader consulting individual run records
