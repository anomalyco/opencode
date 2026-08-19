## ADDED Requirements

### Requirement: a registered command MUST do what it says or not exist

Every CLI command registered in `fork/commands.ts` SHALL perform the action its `describe`
string claims, or SHALL be removed.

A command that mutates process-local state and exits, or that prints guidance referring to
configuration that does not exist, MUST NOT remain registered. Reporting success for
nothing is worse than absence: absence is discoverable, and a false success is acted on.

#### Scenario: a no-op command is not offered

- **WHEN** `opencode --help` is listed
- **THEN** it contains no command whose only behaviour is to print a message about state it does not change

#### Scenario: guidance names something real

- **WHEN** a command directs the reader to a configuration key
- **THEN** that key exists in the configuration schema

### Requirement: fork-owned code with no reachable caller SHALL be removed

Unreferenced fork-owned modules SHALL be deleted rather than left in the tree.

A module qualifies when it is absent from `upstream/dev`, has no inbound import, and is not
reachable through a package `imports`/`exports` condition.

#### Scenario: an unreferenced fork module is gone

- **WHEN** the source tree is scanned for modules with no inbound reference
- **THEN** no fork-owned module remains that is unreachable from any entry point

### Requirement: unreachable code that works SHALL be wired up, not deleted

Working fork-owned functionality that is merely unregistered SHALL be connected rather than
removed.

"Unreferenced" and "useless" are different findings and lead to opposite actions. A
registered command that does nothing is a lie and goes. A complete, working command that
was never registered is an omission, and deleting it destroys working code to satisfy a
tidiness rule.

The test is whether it does something real when reached, not whether anything reaches it.

#### Scenario: an unregistered working command is registered

- **WHEN** a sweep finds a fork-owned CLI command that is exported, unregistered, and operates on a live service
- **THEN** it is registered and verified to run, not deleted

#### Scenario: a registered command that does nothing is removed

- **WHEN** a registered command's only behaviour is reporting state it does not change
- **THEN** it is removed

### Requirement: upstream files MUST NOT be deleted for being unreferenced

A module that exists on `upstream/dev` SHALL NOT be deleted on the grounds that this fork
does not reference it.

Deleting an upstream file yields a conflict on every subsequent sync and no benefit.
Whether upstream code is dead is upstream's decision.

#### Scenario: an unreferenced upstream file is retained

- **WHEN** a dead-code sweep finds an unreferenced module that exists on `upstream/dev`
- **THEN** the file is retained and recorded as deliberately kept

### Requirement: a dead-code sweep MUST resolve conditional module references

Before a module is treated as unreferenced, the sweep SHALL check the owning package's
`imports` and `exports` conditions.

A module reached only through a condition key — `#sqlite`, `#pty`, `#fff` — has no import
specifier naming it anywhere and will otherwise be reported as dead. Acting on that report
removes the database, pty, or filesystem layer.

#### Scenario: condition-resolved modules survive the sweep

- **WHEN** the sweep evaluates a module referenced only from an `imports` condition
- **THEN** it is reported as live
