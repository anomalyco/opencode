## ADDED Requirements

### Requirement: /loop starts a loop from the prompt
The TUI SHALL register a `/loop` slash command accepting `<prompt> [--interval <sec>] [--max <n>] [--no-progress-limit <n>]`. Without `--interval` the loop is ralph-style (iterate until COMPLETE or max); with `--interval` the prompt is re-sent every N seconds. Argument parsing SHALL use the same helper as the CLI so flags cannot drift.

#### Scenario: ralph-style loop from the TUI
- **WHEN** the user submits `/loop fix all failing tests --max 10`
- **THEN** a loop starts via the loop service with max 10 iterations and a confirmation toast shows the loop id

#### Scenario: empty prompt opens management
- **WHEN** the user submits `/loop` with no arguments
- **THEN** the loops management dialog opens instead of an error

### Requirement: /loops management dialog
The TUI SHALL provide a `/loops` command (palette: "Manage loops") listing all loops with status, iteration count, and last-run time, offering pause, resume, and cancel actions, and navigation to any iteration's session.

#### Scenario: pause from the dialog
- **WHEN** the user opens /loops and selects pause on a running loop
- **THEN** the loop pauses and the row updates via the loop.updated event

#### Scenario: jump to an iteration transcript
- **WHEN** the user selects an iteration entry in the dialog
- **THEN** the TUI navigates to that iteration's child session

### Requirement: loop lifecycle notifications in the TUI
The TUI SHALL surface a notification when a loop completes, stalls, or reaches max iterations, including the loop's prompt head and final status.

#### Scenario: stalled loop is noticed
- **WHEN** a loop stops with status stalled while the user is in another session
- **THEN** a toast/notification names the loop and its stalled status
