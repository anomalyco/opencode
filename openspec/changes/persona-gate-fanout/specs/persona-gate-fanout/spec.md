## ADDED Requirements

### Requirement: the fan-out nudge SHALL name the persona for the current gate

When a queue iteration's brief includes the fan-out nudge, it SHALL name the specific
agent bound to the gate the iteration is at, rather than referring generically to the task
tool.

The nudge SHALL remain conditional on idle fleet capacity, and SHALL additionally be
omitted when the bound agent is not present in the agent registry — an instruction the
model cannot carry out is worse than no instruction.

#### Scenario: the nudge names the gate's agent

- **WHEN** an iteration is at the `implement` gate, the fleet has idle capacity, and a `coder` agent exists
- **THEN** the brief instructs delegation of implementation slices to `coder` by name

#### Scenario: no agent, no nudge

- **WHEN** the fleet has idle capacity but the gate's bound agent is absent from the registry
- **THEN** the brief contains no fan-out instruction for that gate

#### Scenario: a busy fleet still suppresses fan-out

- **WHEN** no local provider is idle
- **THEN** the brief contains no fan-out instruction, regardless of which agents exist

### Requirement: a gate MAY be satisfied by a subagent verdict instead of a command

The queue SHALL support agent gates: a gate whose pass or fail is decided by a named
subagent's verdict rather than by a shell command's exit status.

An agent gate SHALL pass when its subagent returns a pass verdict and fail when it returns
a fail verdict. A subagent that errors, times out, or returns no recognisable verdict SHALL
be treated as a gate failure, never as a pass — an unattended run must not advance toward
`commit` because a reviewer crashed.

Agent gate failures SHALL use the same failure path as command gate failures: the verdict
text becomes the failure detail carried into the next iteration's brief, the same strike
count applies, and the same quarantine threshold applies.

#### Scenario: a pass verdict advances the gate

- **WHEN** the `verify` agent gate's subagent returns a pass verdict
- **THEN** the gate passes and the run proceeds to the next gate

#### Scenario: a fail verdict drives a repair turn

- **WHEN** the `verify` agent gate's subagent returns a fail verdict with findings
- **THEN** the gate fails, the findings appear as the failure detail on the next iteration's brief, and the gate is retried after a model turn

#### Scenario: an unusable result is a failure, not a pass

- **WHEN** the gate's subagent errors, times out, or returns text with no recognisable verdict
- **THEN** the gate fails

### Requirement: the reviewer MUST NOT be able to edit the work it is judging

A subagent invoked as an agent gate SHALL run with its own persona's permission ruleset,
derived under the running session's authority ceiling.

For the default `verify` binding this means the reviewer is denied `write` and `edit`. A
gate that can repair its own complaint cannot be relied on to report one.

It also means the gate's subagent SHALL be denied `bash`. Denying the write and edit tools
while permitting a shell is not a restriction: `cat > f`, `git diff HEAD > f`, and
`printf ... | tee f` all write, and no allowlist of command prefixes prevents them —
`cat*` matches `cat > f`. This was observed twice on live runs, the reviewer announcing it
could not write its review and then writing it with a heredoc. A gate subagent reads
through `read`, `grep`, and `glob`, and receives the diff and `git status` in its brief.

#### Scenario: the review gate's subagent cannot write

- **WHEN** the `verify` agent gate runs with the default `reviewer` binding
- **THEN** the subagent's session denies `write` and denies `edit`

#### Scenario: the review gate's subagent has no shell to write through

- **WHEN** the `verify` agent gate runs with the default `reviewer` binding
- **THEN** the subagent is denied `bash` for every command, including read-only ones

#### Scenario: it can still read what it judges

- **WHEN** the `verify` agent gate's subagent inspects the change
- **THEN** `read`, `grep`, and `glob` are available to it

#### Scenario: the authority ceiling still applies

- **WHEN** an agent gate's subagent runs during a queue run
- **THEN** the run's deny rules are still in force for that subagent

### Requirement: gate-to-persona bindings SHALL be configurable, and a broken binding SHALL fail loudly

Gate-to-persona bindings SHALL be configurable under `experimental.queue_personas`,
mapping a gate name to an agent name.

A gate mapped to `false`, or absent from the map with no default, SHALL keep its existing
behaviour. A gate mapped to an agent name that is not in the registry SHALL cause the run
to report a configuration error when it starts, rather than silently skipping the gate.

#### Scenario: a binding is turned off

- **WHEN** `queue_personas.verify` is `false`
- **THEN** `verify` behaves as a command gate and no reviewer subagent is invoked

#### Scenario: a binding to a missing agent is reported at start

- **WHEN** a queue run starts with `queue_personas.verify` naming an agent absent from the registry
- **THEN** the run reports the misconfiguration before the first iteration and does not treat the gate as passed
