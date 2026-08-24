## REMOVED Requirements

### Requirement: automatic replies when the model pauses for input
**Reason**: never implemented. The service was never registered in the runtime layer
graph, was never called from the session turn loop, read a config that was not in the
config schema, and persisted nothing. `--status` could not observe `--enable` because
each CLI invocation built a private throwaway layer.

**Migration**: use `/loop` (see `loop-service`). `/loop <prompt>` drives continued work
without human turns, with a disclosed completion token, an iteration cap, and
no-progress detection. For unattended multi-change work, see `loop-spec-queue`.

#### Scenario: the command no longer exists
- **WHEN** a user runs `opencode auto-reply --enable`
- **THEN** the CLI reports an unknown command, rather than reporting success and doing nothing

#### Scenario: documentation points at the working feature
- **WHEN** a user reads the automation documentation looking for automatic continuation
- **THEN** the documentation describes `/loop` and does not claim an auto-reply feature exists
