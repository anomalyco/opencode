## ADDED Requirements

### Requirement: a loop can target a queue of openspec changes

A loop SHALL support a queue mode whose unit of work is an openspec change. With no
changes named, the queue SHALL be every active change under `openspec/changes/`,
excluding `archive/`, `_repo/`, and any change holding `.skein/blocker.md`. The resolved
order SHALL be reported when the run starts.

Discovered changes SHALL be ordered by an explicit `priority` from the change's
`.openspec.yaml` (lower first), then by its `created` date (oldest first), then by slug —
a total, stable order a large backlog can actually steer. An explicitly named change list
SHALL be honoured in the caller's order, since naming the changes is itself the priority
statement.

#### Scenario: queue order is explicit

- **WHEN** a queue loop starts with no changes named
- **THEN** the run reports the ordered list of changes it will attempt before the first iteration

#### Scenario: priority overrides date

- **WHEN** one eligible change declares `priority: 1` and the others declare none
- **THEN** that change is attempted first regardless of its creation date or slug

#### Scenario: undeclared priority falls back to oldest-first

- **WHEN** no eligible change declares a priority
- **THEN** they are attempted oldest `created` date first, not in alphabetical slug order

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
failure output as context. Three consecutive failures of the same gate SHALL quarantine
the change and advance the queue.

#### Scenario: failing tests return to implement

- **WHEN** the `test` gate fails
- **THEN** the next iteration is an `implement` iteration whose prompt includes the test failure output

#### Scenario: repeated gate failure quarantines rather than grinding

- **WHEN** the `verify` gate fails three times consecutively
- **THEN** the change is quarantined with `verify` recorded as the cause, and the loop advances to the next change

#### Scenario: gate failure with tool activity still quarantines

- **WHEN** a gate fails three times while every iteration makes tool calls
- **THEN** the change is quarantined, even though the existing no-progress guard would not fire

### Requirement: the MODEL cannot push or deploy; the DRIVER publishes one verified branch

A queue loop SHALL run under a permission profile that denies pushing, tagging,
publishing, releasing, and deploying to every session in the run. The restriction SHALL be
enforced by the permission system rather than by prompt instruction, and SHALL NOT be
bypassable by invoking the denied operation indirectly.

Separately, and by default, the loop's driver SHALL push a change's branch once that
change has passed the `commit` gate. This is not a relaxation of the boundary above — it
is the distinction the boundary exists to draw. An unattended agent that may push whatever
it constructs is a different risk from a harness that pushes one ref it computed itself,
after gates it evaluated itself, and reports exactly what it did.

The driver SHALL push only the current branch, SHALL refuse to push the default branch,
and SHALL NOT merge, tag, or release. A push failure SHALL be reported and SHALL NOT change
the change's outcome — the work is done and committed either way.

Pushing SHALL be disableable per run.

#### Scenario: the model's own push is denied

- **WHEN** an iteration attempts `git push`
- **THEN** the command is denied by the permission layer and the denial is recorded in the run report

#### Scenario: deploy is denied

- **WHEN** an iteration attempts to run a deploy or release script
- **THEN** the command is denied

#### Scenario: indirection does not bypass the boundary

- **WHEN** an iteration attempts to push via a wrapper script, an alias, or a generated script it then executes
- **THEN** the push does not succeed

#### Scenario: a completed change is published

- **WHEN** a change passes the `commit` gate
- **THEN** the driver pushes the current branch to origin and the report names the branch pushed

#### Scenario: the default branch is never pushed

- **WHEN** the current branch is the repository's default branch at the point the driver would push
- **THEN** no push is attempted and the refusal is reported

#### Scenario: a failed push does not fail the change

- **WHEN** the push command exits non-zero
- **THEN** the change is still reported as completed and the push failure is reported alongside it

#### Scenario: pushing can be turned off

- **WHEN** a run is started with pushing disabled
- **THEN** no push is attempted and the report says the commits are waiting locally

### Requirement: a stuck change is quarantined, not allowed to halt the queue

The loop SHALL quarantine a stuck change rather than halt the queue. When a change is
stuck — three consecutive failures of the same gate, a stall, `max_reached`, or a
deliberate blocked signal — the loop SHALL write `.skein/blocker.md` into that change (naming the gate or reason, the verbatim failure
output, and a timestamp), leave the working tree otherwise unmodified from the failure
point, and advance to the next eligible change. A quarantined change SHALL be excluded
from the remainder of the run and from future runs until the blocker is removed.

#### Scenario: quarantine names the cause and the queue continues

- **WHEN** the second of four changes exhausts its `verify` gate
- **THEN** that change's `.skein/blocker.md` records `verify` and the failure output, and the run continues with the third change

#### Scenario: deliberate block quarantines with the model's reason

- **WHEN** an iteration emits `<promise>BLOCKED</promise>` with a reason
- **THEN** the change is quarantined, the reason appears in its blocker file and the run report, and the queue advances

### Requirement: the run ends only when no eligible work remains

The queue SHALL be re-resolved from disk as the run progresses, so changes created while
the run is live join it. The run SHALL end only when a fresh resolution finds no eligible
change with unchecked tasks — every change is then either complete or quarantined.

#### Scenario: work added mid-run is picked up

- **WHEN** a new change directory with unchecked tasks appears while the run is draining the queue
- **THEN** the new change is attempted before the run ends

#### Scenario: drained queue ends the run with a full accounting

- **WHEN** a fresh resolution finds no eligible change
- **THEN** the run ends and the report classifies every change seen as completed or quarantined-with-cause

### Requirement: a systemic failure halts instead of quarantining the backlog

The loop SHALL halt with a suspected systemic cause, rather than continue quarantining, if
three consecutive changes are quarantined without any gate having passed anywhere in the
run — quarantine is for sick changes, not a sick environment. A command-backed gate
(`test`, `verify`) that has never passed once in a run SHALL likewise halt the run, and
SHALL NOT leave the change quarantined: an unrunnable gate is evidence about the command,
not about the change.

#### Scenario: broken test runner does not consume the backlog

- **WHEN** the first three changes attempted each exhaust `test` with the test command itself failing to start
- **THEN** the run halts naming the shared failure, and no further changes are quarantined

### Requirement: the iteration brief surfaces idle fleet capacity

The per-iteration brief SHALL surface idle fleet capacity when local subagent placement is
enabled and at least one idle local peer provider is available, reminding the model that
the task tool can place subagents on those peers. The brief SHALL NOT overstate capacity —
no idle peers, no nudge.

#### Scenario: idle peers produce a fan-out nudge

- **WHEN** an iteration is dispatched while two local peers are idle
- **THEN** the brief names the fan-out option so implement/test/verify work can be delegated in parallel

#### Scenario: busy fleet produces no nudge

- **WHEN** every local peer is busy or unreachable
- **THEN** the brief contains no fan-out nudge

### Requirement: the run produces a report

A completed or halted queue run SHALL produce a report covering, per change, the final
gate reached, iterations used, and commit sha if any; plus which branches were pushed, or
why they were not.

#### Scenario: report says what was published

- **WHEN** a queue run completes all changes
- **THEN** the report lists each branch pushed, and states that nothing was merged into the default branch
