## MODIFIED Requirements

### Requirement: plain loops check for further work before finalizing on completion

When a plain-mode (non-queue) loop iteration emits the completion token, the loop SHALL run
the disk-derived eligible-change resolution used by queue mode before finalizing status
`completed`. If an eligible change with unchecked tasks exists, the loop SHALL transition into
queue-style continuation instead of finalizing, and SHALL report the transition. If none exists,
the loop SHALL finalize as `completed` exactly as before this change.

#### Scenario: completion with more planned work continues the loop
- **WHEN** a plain loop's prompt completes and `openspec/changes/` has another eligible change with unchecked tasks
- **THEN** the loop does not finalize as `completed`; it transitions to queue-style continuation and reports the transition

#### Scenario: completion with no further work stops exactly as before
- **WHEN** a plain loop's prompt completes and no eligible change with unchecked tasks exists
- **THEN** the loop finalizes as `completed`, unchanged from prior behavior

### Requirement: a bounded stall reprieve precedes halting

When a plain-mode loop's no-progress streak reaches `noProgressLimit`, the loop SHALL send one
additional directive prompt ("you appear stuck — reassess...") before finalizing as `stalled`.
A second consecutive stall after the reprieve SHALL halt immediately with no further retry.

#### Scenario: one reprieve is granted
- **WHEN** a loop's no-progress streak reaches its limit for the first time
- **THEN** the loop sends the directive reprieve prompt instead of finalizing as `stalled`

#### Scenario: a second stall after the reprieve halts
- **WHEN** the loop stalls again on the iteration immediately following the reprieve
- **THEN** the loop finalizes as `stalled` with no further reprieve

### Requirement: `eternal` can be disabled to restore prior behavior

Loop creation SHALL accept an optional `eternal` flag, defaulting to `true`. When `false`, the
loop SHALL finalize on completion and on reaching the stall limit exactly as it did before this
change, skipping both continuation-on-completion and the stall reprieve.

#### Scenario: `--eternal=false` restores stop-on-completion
- **WHEN** a loop is created with `eternal: false` and its prompt completes while other eligible work exists
- **THEN** the loop finalizes as `completed` without transitioning to continuation

### Requirement: queue ordering is priority-aware

Eligible-change resolution SHALL order candidates by an optional `priority` field where present,
falling back to alphabetical order for changes without one.

#### Scenario: a higher-priority change is worked first
- **WHEN** two eligible changes exist and one declares a higher priority than the other
- **THEN** the higher-priority change is selected first

### Requirement: tool-call counting reflects the whole turn

`IterationInfo.toolCalls` SHALL count tool calls across the entire iteration turn, not only the
final assistant message.

#### Scenario: a multi-step turn is not miscounted as a stall
- **WHEN** an iteration makes a tool call, then reasons, then makes a second tool call before its final message
- **THEN** `toolCalls` reflects both tool calls, not zero
