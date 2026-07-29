## ADDED Requirements

### Requirement: a loop can target a queue of openspec changes
A loop SHALL support a queue mode whose unit of work is an openspec change. With no
changes named, the queue SHALL be every active change under `openspec/changes/`,
excluding `archive/`, `_repo/`, and any change holding `.skein/blocker.md`. The resolved
order SHALL be printed when the run starts.

#### Scenario: queue order is explicit
- **WHEN** a queue loop starts with no changes named
- **THEN** the run reports the ordered list of changes it will attempt before the first iteration

#### Scenario: blocked changes are skipped
- **WHEN** a change directory contains `.skein/blocker.md`
- **THEN** that change is not included in the queue

### Requirement: completion is verified against disk, never asserted by the model
A change SHALL be treated as complete only when every checkbox in its `tasks.md` is
checked and its stated validation commands exit zero. A completion token in model output
SHALL be treated as a claim that triggers verification, and SHALL NOT by itself complete
a change.

#### Scenario: false completion claim is rejected and fed back
- **WHEN** an iteration emits the completion token while two tasks remain unchecked
- **THEN** the change does not advance, and the next iteration's prompt names the unchecked tasks and any failing validation output

#### Scenario: verified completion advances the queue
- **WHEN** all checkboxes are checked and all validation commands exit zero
- **THEN** the change is recorded complete and the loop advances to the next change

### Requirement: the queue cursor survives a restart
The current position SHALL be derived from on-disk task state rather than from in-memory
loop state, so a queue run resumes at the correct change after a server restart.

#### Scenario: restart resumes mid-queue
- **WHEN** a queue run is interrupted by a server restart after finishing 2 of 4 changes
- **THEN** a resumed queue run begins at the third change without repeating the first two

#### Scenario: concurrent queue loops are refused
- **WHEN** a queue loop is already active for a directory and another is requested for the same directory
- **THEN** the second request is refused with a message naming the active loop

### Requirement: phase gates advance in one direction with bounded retries
Within a change the loop SHALL advance through `implement`, `test`, `verify`, `commit`,
and SHALL NOT skip a gate. A gate failure SHALL return the loop to `implement` with the
failure output as context. Three consecutive failures of the same gate SHALL halt the queue.

#### Scenario: failing tests return to implement
- **WHEN** the `test` gate fails
- **THEN** the next iteration is an `implement` iteration whose prompt includes the test failure output

#### Scenario: repeated gate failure halts rather than grinding
- **WHEN** the `verify` gate fails three times consecutively
- **THEN** the queue halts and reports `verify` on that change as the cause

#### Scenario: gate failure with tool activity still halts
- **WHEN** a gate fails three times while every iteration makes tool calls
- **THEN** the queue halts, even though the existing no-progress guard would not fire

### Requirement: unattended runs cannot push or deploy
A queue loop SHALL run under a permission profile that denies pushing, tagging,
publishing, releasing, and deploying. The restriction SHALL be enforced by the permission
system rather than by prompt instruction, and SHALL NOT be bypassable by invoking the
denied operation indirectly.

#### Scenario: push is denied
- **WHEN** an iteration attempts `git push`
- **THEN** the command is denied by the permission layer and the denial is recorded in the run report

#### Scenario: deploy is denied
- **WHEN** an iteration attempts to run a deploy or release script
- **THEN** the command is denied

#### Scenario: indirection does not bypass the boundary
- **WHEN** an iteration attempts to push via a wrapper script, an alias, or a generated script it then executes
- **THEN** the push does not succeed

#### Scenario: local commit is permitted
- **WHEN** the `commit` gate is reached
- **THEN** the loop commits to a non-default branch and does not push

### Requirement: the queue halts loudly and leaves the tree intact
On any halt the loop SHALL stop the whole queue, leave the working tree unmodified from
that point, and report the halting change, the gate that failed, and the verbatim failure
output. The model MAY halt deliberately by emitting a blocked signal with a reason.

#### Scenario: halt names the cause
- **WHEN** the queue halts on the second of four changes
- **THEN** the report names that change, the failed gate, the failure output, and lists the remaining unattempted changes

#### Scenario: deliberate block is honoured
- **WHEN** an iteration emits `<promise>BLOCKED</promise>` with a reason
- **THEN** the queue halts and the reason appears in the report

### Requirement: the run produces a report
A completed or halted queue run SHALL produce a report covering, per change, the final
gate reached, iterations used, and commit sha if any; plus what is committed and awaiting
the user's push.

#### Scenario: report tells the user what to push
- **WHEN** a queue run completes all changes
- **THEN** the report lists each branch and commit created, and states that nothing was pushed
