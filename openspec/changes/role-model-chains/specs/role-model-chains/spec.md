## ADDED Requirements

### Requirement: an agent MAY declare an ordered model preference chain

An agent definition SHALL accept an optional ordered `models` list of `provider/model`
entries expressing preference for which model runs that agent.

Entries SHALL be tried in declaration order, and the first entry that is reachable and has
capacity SHALL be used.

#### Scenario: the first usable entry wins

- **WHEN** an agent declares a chain whose first entry is unreachable and whose second is idle
- **THEN** the subagent runs on the second entry

#### Scenario: no chain means no change

- **WHEN** an agent declares no `models` list
- **THEN** model resolution is unchanged from pinned-model, then placement, then inherited

### Requirement: an unsatisfiable chain MUST degrade, never halt

When no entry in an agent's chain is usable, resolution SHALL continue with the existing
fallback order — placement onto an idle local provider, then the parent's inherited model.

An unsatisfiable chain MUST NOT fail the subagent invocation, fail a gate, or halt a run.
A chain expresses preference; unmet preference is a downgrade, not an error. This is the
specific failure mode that made per-role routing unusable before.

The chosen entry, or the fact that the chain was exhausted and what was used instead,
SHALL be reported with the subagent invocation.

#### Scenario: an entirely unreachable chain still runs the work

- **WHEN** an agent declares a chain in which no entry is reachable
- **THEN** the subagent still runs, using placement or the inherited model

#### Scenario: the downgrade is visible

- **WHEN** a chain is exhausted and the subagent falls through to placement or inherit
- **THEN** the invocation reports that the chain was exhausted and which model was used

#### Scenario: a satisfied chain reports its choice

- **WHEN** a chain entry is used
- **THEN** the invocation reports which entry was chosen

### Requirement: a pinned model and a chain MUST NOT be declared together

An agent definition declaring both `model` and `models` SHALL be reported as a
configuration error when the agent is loaded.

`model` is an absolute pin that disables placement; `models` is a preference that permits
falling through to placement. An agent cannot mean both, and resolving the ambiguity
silently would make routing unpredictable exactly where it needs to be legible.

#### Scenario: declaring both is rejected

- **WHEN** an agent definition declares both `model` and `models`
- **THEN** loading that agent reports a configuration error naming the conflict

#### Scenario: a pin still disables placement

- **WHEN** an agent declares only `model`
- **THEN** placement is not consulted and the pinned model is used
