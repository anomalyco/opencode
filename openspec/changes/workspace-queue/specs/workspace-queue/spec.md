## ADDED Requirements

### Requirement: a workspace run discovers its repos from disk

A workspace run SHALL discover the repositories it drives by scanning the workspace
directory for subdirectories containing `openspec/changes` with at least one eligible
change, to a configurable depth defaulting to one. The discovered set SHALL be reported
before the first repo starts, and SHALL NOT come from a registry, a config list, or any
state carried between runs.

#### Scenario: repos are found beneath the workspace

- **WHEN** a workspace run starts in a directory whose subdirectories include three openspec repos and several unrelated directories
- **THEN** it reports exactly those three repos as the run's scope

#### Scenario: a repo with nothing eligible is not attempted

- **WHEN** a discovered repo's changes are all complete or quarantined
- **THEN** it is excluded from the run's scope and named as already drained in the report

#### Scenario: a workspace with no repos says so

- **WHEN** a workspace run starts where no subdirectory has an openspec backlog
- **THEN** the run ends reporting that nothing was found, and does not report a drained backlog

### Requirement: gate configuration resolves per repository

Gate options SHALL resolve from the repository's own configuration first, then the
workspace defaults, then the built-in defaults. A workspace run SHALL NOT apply one
repository's test, verify, working-directory or default-branch settings to another.

#### Scenario: each repo uses its own gate commands

- **WHEN** two repos in a run declare different `experimental.queue_gate.test_command` values
- **THEN** each repo's queue run executes its own test command

#### Scenario: workspace defaults fill the gaps

- **WHEN** a repo declares only a test command and the workspace declares a verify command
- **THEN** that repo uses its own test command and the workspace's verify command

### Requirement: repos run concurrently within real capacity

A workspace run SHALL run repositories concurrently, bounded by both a configured maximum
and the number of local providers with free capacity at the time each repo is started,
with a floor of one. Concurrency SHALL be re-evaluated as repos start rather than fixed
when the run begins.

#### Scenario: concurrency follows the fleet

- **WHEN** two local providers report free capacity and the configured maximum is four
- **THEN** at most two repos run at the same time

#### Scenario: no local capacity still makes progress

- **WHEN** no local provider reports free capacity
- **THEN** the run proceeds one repo at a time rather than stalling

#### Scenario: concurrency never applies within a repo
- **WHEN** a repo is being worked by the run
- **THEN** only one queue run exists for that repository's working tree

### Requirement: repo order avoids starvation

A workspace run SHALL order repositories by an explicit list when given, then by
configured priority, then by least-recently-attempted, then by name. Ordering SHALL NOT
allow a repository with continuously available work to prevent other repositories from
ever being attempted.

#### Scenario: the least recently worked repo goes first

- **WHEN** two repos have equal priority and one was last committed to weeks before the other
- **THEN** the staler repo is attempted first

#### Scenario: an explicit list wins

- **WHEN** a workspace run names its repos explicitly
- **THEN** they are attempted in the order given, and no others are attempted

### Requirement: a halted repository does not halt the workspace

A workspace run SHALL record a repository that halts — misconfigured gate, systemic
guard, or error — and SHALL continue with the next repository. The run SHALL end only
when every discovered repository has been attempted or excluded.

#### Scenario: one bad repo does not end the run

- **WHEN** the second of five repos halts on a misconfigured gate
- **THEN** its cause is recorded and the run continues with the third

#### Scenario: a repeatedly failing environment stops the run

- **WHEN** three consecutive repositories halt without any gate passing anywhere in the run
- **THEN** the run stops and reports a suspected environmental cause rather than attempting the rest

### Requirement: the authority ceiling is inherited unchanged

A workspace run SHALL NOT widen the per-repository authority ceiling. Every repository's
work SHALL run under the same deny profile and credential-less shell a single-repo queue
run uses, and the workspace run SHALL NOT push, tag, publish, release or deploy.

#### Scenario: nothing is pushed

- **WHEN** a workspace run completes work in several repositories
- **THEN** each repository has local commits on non-default branches and no push has occurred

### Requirement: one report covers the whole run

A workspace run SHALL produce a single report covering, per repository: changes completed,
changes quarantined with cause, branches created and awaiting review, whether a tracker
sync ran, and whether the repository halted and why. The report SHALL distinguish
repositories this run attempted from repositories that were already drained.

#### Scenario: the report is readable in one place

- **WHEN** a run touched twelve repositories
- **THEN** its report states each repository's outcome without the reader consulting individual loop records

### Requirement: Auto in a workspace starts a workspace run

Selecting Auto in a directory that is a workspace rather than a repository SHALL start a
workspace run over the repositories beneath it. Selecting Auto inside a repository SHALL
continue to start a single-repository run, and the optional standing instruction SHALL
apply to every repository in a workspace run.

#### Scenario: Auto from the workspace directory works everything

- **WHEN** Auto is selected in a directory containing repos rather than an `openspec/changes` of its own
- **THEN** a workspace run starts over those repos instead of failing with a list of them

#### Scenario: leaving Auto stops the whole workspace run

- **WHEN** Auto is switched off while a workspace run is going
- **THEN** the workspace run and every per-repository run it started are stopped
