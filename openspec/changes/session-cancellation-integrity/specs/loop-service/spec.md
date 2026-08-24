## MODIFIED Requirements

### Requirement: cancelling a loop aborts its in-flight turn
`Loop.cancel` SHALL abort the running model turn for the loop's session in addition to
flipping loop status. All cancel entry points — TUI Esc, the `/loops` dialog, and
`opencode loop cancel` — SHALL produce identical behaviour.

#### Scenario: dialog cancel stops the model
- **WHEN** a loop has a model turn in flight and the user cancels it from the `/loops` dialog
- **THEN** the in-flight turn is aborted rather than running to completion

#### Scenario: CLI cancel stops the model
- **WHEN** a loop has a model turn in flight and `opencode loop cancel <id>` is run
- **THEN** the in-flight turn is aborted and the loop reports `cancelled`

### Requirement: terminal loop status is sticky
`finalize` SHALL NOT overwrite a status that is already terminal, and SHALL NOT rewrite
`finishedAt` in that case. Terminal statuses are `completed`, `stalled`, `cancelled`,
`max_reached`, and `error`.

#### Scenario: cancel is not overwritten by a late iteration result
- **WHEN** a user cancels a loop while an iteration is in flight, and that iteration then returns output containing the completion token
- **THEN** the loop remains `cancelled` with its original `finishedAt`, and is not reported as `completed`

#### Scenario: cancel is not overwritten by stall or cap detection
- **WHEN** a user cancels a loop on the iteration that would have tripped the no-progress limit or the iteration cap
- **THEN** the loop remains `cancelled` rather than becoming `stalled` or `max_reached`

### Requirement: a loop iteration does not adopt a foreign turn
A loop iteration SHALL NOT attribute output to itself that came from a turn it did not
start. When the target session already has a running turn, the iteration SHALL be
recorded as skipped rather than joining that turn.

#### Scenario: concurrent turn is not claimed as an iteration
- **WHEN** a loop iteration dispatches against a session that already has a running turn
- **THEN** the iteration does not report that turn's output as its own result
