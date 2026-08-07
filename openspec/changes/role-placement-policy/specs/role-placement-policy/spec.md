## ADDED Requirements

### Requirement: an agent MAY declare where it wants to run

An agent definition SHALL accept an optional `placement` field expressing which hosts the
role may run on.

It SHALL accept `inherit` (or absence), meaning today's behaviour; `local`, meaning any
eligible local host; or an ordered list of provider ids, meaning those hosts in order and
then any eligible local host.

#### Scenario: an undeclared agent is unaffected

- **WHEN** an agent declares no `placement`
- **THEN** subagent model resolution is unchanged in every respect

#### Scenario: a preferred host is used when it is eligible

- **WHEN** an agent declares an ordered host list and the first host is reachable with a free slot
- **THEN** the subagent runs on that host

### Requirement: a declared local placement SHALL survive a cloud parent

Placement SHALL run for an agent that declares a local placement even when the parent
session's model is not local.

Placement is otherwise skipped for a non-local parent, because moving a cloud parent's
subagents onto local weights unasked is a quality surprise. A role that declares where it
wants to run has asked, so it is no longer a surprise — which is the whole mechanism.

#### Scenario: a cloud parent delegates to a local host

- **WHEN** the parent session runs a cloud model and a subagent whose agent declares `placement: local` is spawned
- **THEN** placement runs and the subagent is placed on an eligible local host

#### Scenario: a cloud parent still does not silently downgrade

- **WHEN** the parent session runs a cloud model and a subagent whose agent declares no placement is spawned
- **THEN** placement does not run and the subagent inherits the parent's model

### Requirement: placement preference MUST NOT be able to fail a run

An unsatisfiable placement preference SHALL fall through to ordinary placement, and then to
the parent's inherited model.

An unreachable, busy, or unknown preferred host MUST NOT fail the subagent invocation, fail
a gate, or halt a run. The preference is where the role would like to run, not a condition
of running.

#### Scenario: every preferred host is unusable

- **WHEN** an agent declares hosts that are all unreachable or have no free slot
- **THEN** the subagent still runs, using ordinary placement or the inherited model

#### Scenario: an unknown provider id is not fatal

- **WHEN** an agent declares a provider id that no longer exists
- **THEN** the subagent still runs and the unusable preference is reported, not raised

### Requirement: an explicit request MUST outrank a role's preference

Resolution order SHALL be: a pinned `model`, then an explicitly requested `provider`
argument, then the role's `placement`, then ordinary placement, then the inherited model.

A caller naming a host for one delegation has said something more specific than the role's
standing preference, and MUST win.

#### Scenario: an explicit provider beats the role preference

- **WHEN** a subagent is spawned with an explicit provider argument and its agent declares a different preferred host
- **THEN** the subagent runs on the explicitly requested host

#### Scenario: a pinned model still disables placement

- **WHEN** an agent declares both a pinned `model` and a `placement`
- **THEN** the pinned model is used and placement does not run
